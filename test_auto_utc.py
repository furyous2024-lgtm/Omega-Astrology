#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path


SERVICE_PATH = Path(__file__).parent / "py" / "swiss_ephemeris_service.py"
SPEC = importlib.util.spec_from_file_location("swiss_ephemeris_service", SERVICE_PATH)
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)


class AutomaticUtcTests(unittest.TestCase):
    def resolve(self, year, month, day, hour, minute, lat, lon):
        return SERVICE.resolve_automatic_utc({
            "utcMode": "auto",
            "year": year,
            "month": month,
            "day": day,
            "hour": hour,
            "minute": minute,
            "lat": lat,
            "long": lon,
        })

    def test_historical_dst_offsets_follow_location_and_date(self):
        winter = self.resolve(2021, 1, 15, 12, 0, 40.7128, -74.0060)
        summer = self.resolve(2021, 7, 15, 12, 0, 40.7128, -74.0060)
        nepal = self.resolve(2021, 1, 15, 12, 0, 27.7172, 85.3240)

        self.assertEqual(winter["timezone"], "America/New_York")
        self.assertEqual(winter["utcOffset"], -5)
        self.assertEqual(summer["utcOffset"], -4)
        self.assertEqual(nepal["utcOffset"], 5.75)

    def test_rejects_nonexistent_and_ambiguous_wall_times(self):
        with self.assertRaisesRegex(ValueError, "does not exist"):
            self.resolve(2021, 3, 14, 2, 30, 40.7128, -74.0060)
        with self.assertRaisesRegex(ValueError, "occurs twice"):
            self.resolve(2021, 11, 7, 1, 30, 40.7128, -74.0060)

    def test_resolves_an_ocean_coordinate(self):
        result = self.resolve(2021, 1, 15, 12, 0, 0, -140)
        self.assertTrue(result["timezone"])
        self.assertGreaterEqual(result["utcOffset"], -14)
        self.assertLessEqual(result["utcOffset"], 14)

    def test_chart_response_contains_the_resolved_utc_metadata(self):
        request = self.resolve(2021, 7, 15, 12, 0, 40.7128, -74.0060)
        result = SERVICE.calculate_payload(request)

        self.assertTrue(result["success"])
        self.assertEqual(result["utcMode"], "auto")
        self.assertEqual(result["utcOffset"], -4)
        self.assertEqual(result["timezone"], "America/New_York")


if __name__ == "__main__":
    unittest.main()
