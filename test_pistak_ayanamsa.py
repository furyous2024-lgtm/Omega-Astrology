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

custom_payload = service.calculate_payload({
    'utcDate': '2000-01-01T12:00:00Z',
    'selectedAyanamsaSystem': 'Ayanamsa Personalizado',
    'customAyanamsaValue': 24.25,
    'lat': 0,
    'long': 0,
})
custom_expected = service.true_sidereal_custom_ayanamsa(
    custom_payload['julianDay'],
    24.25,
)
if abs(custom_payload['ayanamsa'] - custom_expected) > 1e-10:
    raise SystemExit('Chart calculation did not use the custom ayanamsa value')
if abs(custom_payload['ayanamsaValues']['Ayanamsa Personalizado'] - custom_payload['ayanamsa']) > 1e-10:
    raise SystemExit('Custom ayanamsa value was not returned in ayanamsa values')

custom2_payload = service.calculate_payload({
    'utcDate': '2000-01-01T12:00:00Z',
    'selectedAyanamsaSystem': 'Ayanamsa Fixo',
    'customAyanamsaValue': 24.25,
    'lat': 0,
    'long': 0,
})
if abs(custom2_payload['ayanamsa'] - 24.25) > 1e-12:
    raise SystemExit('Personalizado 2 did not use the entered ayanamsa value')

degrees_payload = service.calculate_payload({
    'utcDate': '2000-01-01T12:00:00Z',
    'selectedAyanamsaSystem': 'Ayanamsa Livre',
    'customAyanamsaDegreesValue': -123.25,
    'lat': 0,
    'long': 0,
})
if abs(degrees_payload['ayanamsa'] - (-123.25)) > 1e-12:
    raise SystemExit('Personalizado 3 did not use the entered signed degree value')

dms_payload = service.calculate_payload({
    'utcDate': '2000-01-01T12:00:00Z',
    'selectedAyanamsaSystem': 'Ayanamsa GMS',
    'customAyanamsaDegrees': -12,
    'customAyanamsaMinutes': 30,
    'customAyanamsaSeconds': 15,
    'lat': 0,
    'long': 0,
})
expected_dms = -(12 + 30 / 60.0 + 15 / 3600.0)
if abs(dms_payload['ayanamsa'] - expected_dms) > 1e-12:
    raise SystemExit('Personalizado 4 did not convert DMS correctly')

julian_payload = service.calculate_payload({
    'utcDate': '2000-01-01T12:00:00Z',
    'selectedAyanamsaSystem': 'Ayanamsa Juliana',
    'customAyanamsaJulianDate': 2451545.0,
    'lat': 0,
    'long': 0,
})
expected_julian = service.julian_date_ayanamsa(
    julian_payload['julianDay'],
    2451545.0,
)
if abs(julian_payload['ayanamsa'] - expected_julian) > 1e-12:
    raise SystemExit('Personalizado 5 did not use the entered Julian Date')

print('Pistak 68 BC reference, precession, selection, custom value, and legacy option passed.')
