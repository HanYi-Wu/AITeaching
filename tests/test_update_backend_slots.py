from types import SimpleNamespace

import pytest

from tools.release_verify import backend_slots
from tools.release_verify.backend_slot_runner import slot_configuration


@pytest.mark.parametrize("available, drained", [(True, False), (False, False), (False, True)])
def test_candidate_starts_only_in_safe_inactive_slot(monkeypatch, tmp_path, available, drained):
    store = tmp_path / "slots"
    store.mkdir()
    candidate = tmp_path / "candidate"
    app = candidate / "src" / "solaire" / "web" / "app.py"
    app.parent.mkdir(parents=True)
    app.write_text("# verified candidate")
    identity = "a" * 32
    calls = []

    def systemctl(command, slot, **_):
        calls.append((command, slot))
        if command == "start":
            release, port, version = slot_configuration(store, slot)
            assert release.name == identity and version == "1.7.5" and port == 8001
        return SimpleNamespace(stdout="inactive" if available else "active")

    monkeypatch.setattr(backend_slots, "_systemctl", systemctl)
    monkeypatch.setattr(backend_slots, "drain_confirmed", lambda *args: drained)
    monkeypatch.setattr(backend_slots, "_check_api", lambda *args: None)
    captured = {}
    monkeypatch.setattr(backend_slots, "activate_backend", lambda *args, **kwargs: captured.update(kwargs) or 0.2)
    controller = backend_slots.BackendSlots(store, 8000, 8001, 8080)
    if available or drained:
        assert controller.publish(candidate, identity, "1.7.5", schema_unchanged=True) == 0.2
        assert captured["expected_slot"] == "primary" and captured["next_slot"] == "standby"
        assert calls == [("is-active", "standby"), *(([("stop", "standby")] if drained else [])), ("start", "standby")]
    else:
        with pytest.raises(ValueError, match="draining"):
            controller.publish(candidate, identity, "1.7.5", schema_unchanged=True)
        assert calls == [("is-active", "standby")]
