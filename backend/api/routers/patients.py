import io

from django.conf import settings
from django.core.files.base import ContentFile
from django.db.models import Count, Q
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

from apps.accounts.models import User
from apps.patients.models import Patient, PatientPhoto

from ..deps import current_user, get_patient_or_404
from ..orm import orm, run
from ..schemas import PatientIn, PatientOut, PatientPatch, PhotoOut

router = APIRouter(tags=["pacientes"])

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_SIDE = 2000


class PatientListOut(PatientOut):
    anamnesis_done: bool
    plans_count: int


def _list_item(p: Patient) -> PatientListOut:
    return PatientListOut.model_validate(
        {**PatientOut.model_validate(p).model_dump(), "anamnesis_done": bool(p.anamnesis_done), "plans_count": p.plans_count}
    )


@router.get("/patients", response_model=list[PatientListOut])
@orm
def list_patients(q: str = "", user: User = Depends(current_user)):
    qs = (
        Patient.objects.filter(owner=user)
        .annotate(
            anamnesis_done=Count("anamnesis", distinct=True),
            plans_count=Count("plans", distinct=True),
        )
    )
    if q.strip():
        term = q.strip()
        qs = qs.filter(Q(full_name__icontains=term) | Q(phone__icontains=term) | Q(email__icontains=term))
    return [_list_item(p) for p in qs]


@router.post("/patients", response_model=PatientOut, status_code=status.HTTP_201_CREATED)
@orm
def create_patient(data: PatientIn, user: User = Depends(current_user)):
    return Patient.objects.create(owner=user, **data.model_dump())


@router.get("/patients/{patient_id}", response_model=PatientOut)
@orm
def get_patient(patient_id: int, user: User = Depends(current_user)):
    return get_patient_or_404(user, patient_id)


@router.patch("/patients/{patient_id}", response_model=PatientOut)
@orm
def update_patient(patient_id: int, data: PatientPatch, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "full_name" and value is None:
            continue
        if value is None and field != "birth_date":
            value = ""
        setattr(patient, field, value)
    patient.save()
    return patient


@router.delete("/patients/{patient_id}", status_code=status.HTTP_204_NO_CONTENT)
@orm
def delete_patient(patient_id: int, user: User = Depends(current_user)):
    patient = get_patient_or_404(user, patient_id)
    for photo in patient.photos.all():
        photo.image.delete(save=False)
    patient.delete()


# ---- fotos ----
def _normalize_image(raw: bytes) -> tuple[bytes, int, int]:
    """Valida, corrige rotação EXIF, limita o tamanho e regrava como JPEG (remove EXIF/GPS)."""
    try:
        probe = Image.open(io.BytesIO(raw))
        probe.verify()
        img = Image.open(io.BytesIO(raw))
        if img.format not in ALLOWED_FORMATS:
            raise ValueError(img.format)
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Envie uma imagem JPEG, PNG ou WebP válida.")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=90)
    return out.getvalue(), img.width, img.height


def _save_photo(user: User, patient_id: int, kind: str, data: bytes) -> PatientPhoto:
    patient = get_patient_or_404(user, patient_id)
    jpeg, width, height = _normalize_image(data)
    photo = PatientPhoto(patient=patient, kind=kind, width=width, height=height)
    photo.image.save("foto.jpg", ContentFile(jpeg), save=False)
    photo.save()
    return photo


@router.post("/patients/{patient_id}/photos", response_model=PhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    patient_id: int,
    file: UploadFile = File(...),
    kind: str = Form(PatientPhoto.Kind.FRONTAL),
    user: User = Depends(current_user),
):
    if kind not in PatientPhoto.Kind.values:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Tipo de foto inválido.")
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Foto maior que {settings.MAX_UPLOAD_MB} MB.")
    return await run(_save_photo)(user, patient_id, kind, data)


@router.get("/patients/{patient_id}/photos", response_model=list[PhotoOut])
@orm
def list_photos(patient_id: int, user: User = Depends(current_user)):
    return list(get_patient_or_404(user, patient_id).photos.all())


def _own_photo(user: User, photo_id: int) -> PatientPhoto:
    photo = PatientPhoto.objects.filter(pk=photo_id, patient__owner=user).first()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foto não encontrada.")
    return photo


@router.get("/photos/{photo_id}/file")
async def photo_file(photo_id: int, user: User = Depends(current_user)):
    photo = await run(_own_photo)(user, photo_id)
    return FileResponse(photo.image.path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
@orm
def delete_photo(photo_id: int, user: User = Depends(current_user)):
    photo = _own_photo(user, photo_id)
    photo.image.delete(save=False)
    photo.delete()
