from __future__ import annotations

from app.config import Settings, should_use_offline_demo_mode


def test_demo_case_forces_offline_mode_even_when_env_flag_is_false() -> None:
    settings = Settings.model_construct(demo_offline_mode=False)

    assert should_use_offline_demo_mode("demo", settings) is True
    assert should_use_offline_demo_mode(" DEMO ", settings) is True


def test_non_demo_case_respects_explicit_env_flag() -> None:
    assert should_use_offline_demo_mode(
        "trial-run",
        Settings.model_construct(demo_offline_mode=False),
    ) is False
    assert should_use_offline_demo_mode(
        "trial-run",
        Settings.model_construct(demo_offline_mode=True),
    ) is True
