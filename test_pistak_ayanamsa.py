#!/usr/bin/env python3
import importlib.util
import os

ROOT = os.path.dirname(__file__)
SERVICE_PATH = os.path.join(ROOT, 'py', 'swiss_ephemeris_service.py')
spec = importlib.util.spec_from_file_location('swiss_ephemeris_service', SERVICE_PATH)
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

reference_jd_tt = service.PISTAK_23_03_68_BC_JD_TT
reference_jd_ut = reference_jd_tt
for _ in range(5):
    reference_jd_ut = reference_jd_tt - service.swe.deltat(reference_jd_ut)

reference_ayanamsa = service.pistak_23_03_68_bc_ayanamsa(reference_jd_ut)
if abs(reference_ayanamsa) > 1e-7:
    raise SystemExit(f'Reference epoch should be 0°, got {reference_ayanamsa}')

long_term_offsets = {}
for offset_years in (-2000, 2000):
    jd_ut = reference_jd_ut + offset_years * 365.2425
    ayanamsa = service.pistak_23_03_68_bc_ayanamsa(jd_ut)
    if abs(ayanamsa) < 1:
        raise SystemExit(f'Expected precession away from reference epoch, got {ayanamsa}')
    long_term_offsets[offset_years] = ayanamsa
    resolved = service.resolve_ayanamsa(
        {'selectedAyanamsaSystem': service.PISTAK_23_03_68_BC_NAME},
        jd_ut,
    )
    if abs(resolved - ayanamsa) > 1e-10:
        raise SystemExit('Selected ayanamsa did not resolve to its own calculation')
if abs(long_term_offsets[-2000] + long_term_offsets[2000]) < 0.1:
    raise SystemExit('Expected the precession model to differ from a constant-rate model')

values = service.current_ayanamsa_values(reference_jd_ut)
if values.get(service.PISTAK_23_03_68_BC_NAME) is None:
    raise SystemExit('New ayanamsa is missing from returned ayanamsa values')
if service.PISTAK_0_ARIES_60_NAME not in values:
    raise SystemExit('Existing Pistak 60 CE ayanamsa was not preserved')

payload = service.calculate_payload({
    'utcDate': '2000-01-01T12:00:00Z',
    'selectedAyanamsaSystem': service.PISTAK_23_03_68_BC_NAME,
    'lat': 0,
    'long': 0,
})
expected = service.resolve_ayanamsa(
    {'selectedAyanamsaSystem': service.PISTAK_23_03_68_BC_NAME},
    payload['julianDay'],
)
if abs(payload['ayanamsa'] - expected) > 1e-10:
    raise SystemExit('Chart calculation did not use the selected ayanamsa')

print('Pistak 68 BC reference, precession, selection, and legacy option passed.')
