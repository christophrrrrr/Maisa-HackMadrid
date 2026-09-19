from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import policy


def test_all_supported_file_types_are_enabled_by_default():
    defaults = policy.defaults()["file_types"]

    assert set(defaults) == set(policy.FILE_TYPE_META)
    assert all(spec["enabled"] for spec in defaults.values())
    assert ".doc" not in policy.accepted_suffixes(policy.defaults())
    assert ".xls" not in policy.accepted_suffixes(policy.defaults())


def test_disabled_file_type_is_not_accepted():
    config = policy.defaults()
    config["file_types"]["email"]["enabled"] = False

    suffixes = policy.accepted_suffixes(config)

    assert ".eml" not in suffixes
    assert ".msg" not in suffixes
    assert ".pdf" in suffixes


def test_save_policy_adds_custom_rule(tmp_path, monkeypatch):
    monkeypatch.setattr(policy, "CONFIG_PATH", tmp_path / "policy.json")

    saved = policy.save_policy({
        "reasons": {
            "custom_check": {
                "label": "Comprobaci\u00f3n personalizada",
                "rule": "6",
                "help": "valida una condici\u00f3n adicional",
            },
        },
        "reason_outcomes": {"custom_check": "NO_PAGAR"},
    })

    assert saved["reasons"]["custom_check"]["rule"] == "6"
    assert saved["reason_outcomes"]["custom_check"] == "NO_PAGAR"
    assert policy.load_policy()["reasons"]["custom_check"]["label"] == "Comprobaci\u00f3n personalizada"


def test_save_policy_edits_default_rule_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(policy, "CONFIG_PATH", tmp_path / "policy.json")
    reasons = policy.defaults()["reasons"]
    reasons["iban_mismatch"] = {
        "label": "IBAN diferente",
        "rule": "finanzas",
        "help": "requiere una revisi\u00f3n bancaria",
    }

    policy.save_policy({
        "reasons": reasons,
        "reason_outcomes": {"iban_mismatch": "NO_PAGAR"},
    })
    loaded = policy.as_ui()

    assert loaded["reasons"]["iban_mismatch"]["label"] == "IBAN diferente"
    assert loaded["reason_outcomes"]["iban_mismatch"] == "NO_PAGAR"
