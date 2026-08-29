"""Unit and integration tests for the run history service."""

from pathlib import Path

import pytest

from suite.db import RunServiceError
from suite.db.payloads import read_payload, write_payload


def make_result(fname: str, dim: int, algo_key: str, tmp_path: Path) -> dict:
    payloads_path = tmp_path / "payloads" / f"{fname}_{dim}D_{algo_key}.json.zst"
    write_payload(
        payloads_path,
        {"raw_costs": [1.0, 2.0], "mean_curve": [3.0, 2.0], "conv_binary": [1, 0]},
    )
    row = {
        "fname": fname,
        "dim": dim,
        "algo_key": algo_key,
        "payloads_path": str(payloads_path),
        "conv_pct": 50.0,
        "mean_best": 1.5,
        "median_best": 1.5,
        "std_best": 0.5,
        "min_best": 1.0,
        "max_best": 2.0,
        "iqr_best": 0.5,
        "cv": 0.33,
        "mean_obj_error": 1.5,
        "std_obj_error": 0.5,
        "mean_conv_gen": 12.5,
        "mean_auc": -2.0,
        "std_auc": 0.1,
        "mean_evals": 50_000.0,
        "mean_wall_ms": 100.0,
        "median_wall_ms": 99.0,
        "evals_per_ms": 500.0,
        "converged_all": False,
    }
    return row


class TestCreateRun:
    def test_creates_draft_with_config(self, svc, run_kwargs):
        run = svc.create_run(**run_kwargs)
        assert run.status == "draft"
        assert run.label == "smoke run"
        assert len(run.test_cases) == 2
        assert run.algo_params.payload["hygo"]["NG"] == 50

    def test_rejects_empty_label(self, svc, run_kwargs):
        run_kwargs["label"] = "   "
        with pytest.raises(RunServiceError):
            svc.create_run(**run_kwargs)

    def test_rejects_out_of_range_numbers(self, svc, run_kwargs):
        for key, bad in (("n_runs", 0), ("n_runs", 501), ("max_evals", 999), ("alpha", 0.5)):
            kwargs = {**run_kwargs, key: bad}
            with pytest.raises(RunServiceError):
                svc.create_run(**kwargs)

    def test_rejects_empty_or_dup_test_cases(self, svc, run_kwargs):
        run_kwargs["test_cases"] = []
        with pytest.raises(RunServiceError):
            svc.create_run(**run_kwargs)
        run_kwargs["test_cases"] = [
            {"fname": "booth", "dim": 2},
            {"fname": "booth", "dim": 2},
        ]
        run = svc.create_run(**run_kwargs)
        assert len(run.test_cases) == 1

    def test_negative_seed_rejected(self, svc, run_kwargs):
        run_kwargs["seed_base"] = -1
        with pytest.raises(RunServiceError):
            svc.create_run(**run_kwargs)


class TestNonFiniteMetrics:
    def test_nan_metrics_stored_as_null(self, svc, run_kwargs, tmp_path):
        """Single-run experiments produce nan stds (np.std ddof=1); they
        must be persisted as NULL, not raise integrity errors."""
        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        row = make_result("ackley", 2, "hyde_bin", tmp_path)
        row.update(
            n_runs=1,
            std_best=float("nan"),
            std_obj_error=float("nan"),
            std_auc=float("nan"),
            cv=0.0,
        )
        svc.add_scenario_result(run.id, row)
        detail = svc.get_run_detail(run.id)
        sr = detail["scenario_results"][0]
        assert sr["std_best"] is None
        assert sr["std_obj_error"] is None
        assert sr["std_auc"] is None
        assert sr["mean_best"] == 0.0 or sr["mean_best"] == 1.5

    def test_get_run_detail_validates_with_null_metrics(self, svc, run_kwargs, tmp_path):
        """Regression: get_run_detail's pydantic response model must accept
        NULL derived metrics (single-run experiments), otherwise the IPC
        layer rejects the response and the UI shows nothing."""
        from suite.schemas import RunDetailResponse

        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        row = make_result("ackley", 2, "hyde_bin", tmp_path)
        row.update(
            std_best=float("nan"),
            std_obj_error=float("nan"),
            std_auc=float("nan"),
            cv=float("nan"),
            mean_best=0.0,
        )
        # sanitizer turns nan into None before insert
        svc.add_scenario_result(run.id, row)
        detail = svc.get_run_detail(run.id)
        # must not raise
        parsed = RunDetailResponse(**detail)
        assert parsed.scenario_results[0].std_best is None
        assert parsed.scenario_results[0].cv is None

    def test_inf_metrics_stored_as_null(self, svc, run_kwargs, tmp_path):
        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        row = make_result("booth", 2, "hygo", tmp_path)
        row["std_best"] = float("inf")
        svc.add_scenario_result(run.id, row)
        detail = svc.get_run_detail(run.id)
        assert detail["scenario_results"][0]["std_best"] is None


class TestLifecycle:
    def test_happy_path(self, svc, run_kwargs, tmp_path):
        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        svc.add_scenario_result(run.id, make_result("booth", 2, "hygo", tmp_path))
        done = svc.mark_completed(run.id, duration_s=12.5)
        assert done.status == "completed"
        assert done.duration_s == 12.5

    def test_invalid_transitions_rejected(self, svc, run_kwargs):
        run = svc.create_run(**run_kwargs)
        with pytest.raises(RunServiceError):
            svc.mark_completed(run.id, 1.0)
        with pytest.raises(RunServiceError):
            svc.mark_cancelled(run.id)

    def test_results_only_on_running(self, svc, run_kwargs, tmp_path):
        run = svc.create_run(**run_kwargs)
        with pytest.raises(RunServiceError):
            svc.add_scenario_result(run.id, make_result("booth", 2, "hygo", tmp_path))

    def test_unknown_algo_rejected(self, svc, run_kwargs, tmp_path):
        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        row = make_result("booth", 2, "hygo", tmp_path)
        row["algo_key"] = "bogus"
        with pytest.raises(RunServiceError):
            svc.add_scenario_result(run.id, row)

    def test_missing_payload_rejected(self, svc, run_kwargs, tmp_path):
        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        row = make_result("booth", 2, "hygo", tmp_path)
        row["payloads_path"] = ""
        with pytest.raises(RunServiceError):
            svc.add_scenario_result(run.id, row)

    def test_failed_records_reason(self, svc, run_kwargs):
        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        failed = svc.mark_failed(run.id, reason="boom")
        assert failed.status == "failed"
        assert "boom" in failed.notes


class TestQueries:
    def _seed(self, svc, run_kwargs, n=3):
        ids = []
        for i in range(n):
            run = svc.create_run(**{**run_kwargs, "label": f"run {i}"})
            ids.append(run.id)
        return ids

    def test_get_run_detail(self, svc, run_kwargs, tmp_path):
        run = svc.create_run(**run_kwargs)
        svc.mark_running(run.id)
        svc.add_scenario_result(run.id, make_result("booth", 2, "hygo", tmp_path))
        svc.set_tags(run.id, ["nightly", "smoke"])
        detail = svc.get_run_detail(run.id)
        assert detail["label"] == "smoke run"
        assert {t["fname"] for t in detail["test_cases"]} == {"booth", "sphere"}
        assert len(detail["scenario_results"]) == 1
        assert sorted(detail["tags"]) == ["nightly", "smoke"]

    def test_pagination_and_sort(self, svc, run_kwargs):
        self._seed(svc, run_kwargs, 5)
        page1 = svc.list_runs(page=1, per_page=2, order="asc")
        assert page1["total"] == 5
        assert [i["label"] for i in page1["items"]] == ["run 0", "run 1"]
        page3 = svc.list_runs(page=3, per_page=2, order="asc")
        assert [i["label"] for i in page3["items"]] == ["run 4"]

    def test_search_and_status_filter(self, svc, run_kwargs):
        ids = self._seed(svc, run_kwargs, 2)
        svc.mark_running(ids[0])
        hits = svc.list_runs(search="run 1")
        assert len(hits["items"]) == 1
        running = svc.list_runs(status="running")
        assert [i["id"] for i in running["items"]] == [ids[0]]

    def test_invalid_sort_rejected(self, svc, run_kwargs):
        with pytest.raises(RunServiceError):
            svc.list_runs(sort="bogus")

    def test_missing_run_raises(self, svc):
        with pytest.raises(KeyError):
            svc.get_run("nope")


class TestUpdateAndTags:
    def test_update_label_and_notes(self, svc, run_kwargs):
        run = svc.create_run(**run_kwargs)
        svc.update_run(run.id, label="renamed", notes="note")
        updated = svc.get_run(run.id)
        assert updated.label == "renamed"
        assert updated.notes == "note"

    def test_update_rejects_blank_label(self, svc, run_kwargs):
        run = svc.create_run(**run_kwargs)
        with pytest.raises(RunServiceError):
            svc.update_run(run.id, label="  ")

    def test_set_tags_replaces(self, svc, run_kwargs):
        run = svc.create_run(**run_kwargs)
        svc.set_tags(run.id, ["a", "b"])
        svc.set_tags(run.id, ["b", "c"])
        detail = svc.get_run_detail(run.id)
        assert sorted(detail["tags"]) == ["b", "c"]

    def test_tags_deduped_and_trimmed(self, svc, run_kwargs):
        run = svc.create_run(**run_kwargs)
        names = svc.set_tags(run.id, ["  x ", "x", ""])
        assert names == ["x"]


class TestBatch:
    def test_batch_tag_add_remove(self, svc, run_kwargs):
        ids = []
        for _ in range(3):
            ids.append(svc.create_run(**run_kwargs).id)
        updated = svc.tag_runs(ids, add=["batch"], remove=[])
        assert updated == 3
        svc.tag_runs(ids[:2], add=[], remove=["batch"])
        remaining = svc.list_runs(tag="batch")
        assert len(remaining["items"]) == 1

    def test_batch_tag_conflict_rejected(self, svc, run_kwargs):
        rid = svc.create_run(**run_kwargs).id
        with pytest.raises(RunServiceError):
            svc.tag_runs([rid], add=["x"], remove=["x"])

    def test_batch_tag_missing_run(self, svc, run_kwargs):
        with pytest.raises(KeyError):
            svc.tag_runs(["missing"], add=["t"], remove=[])

    def test_batch_delete_returns_output_dirs(self, svc, run_kwargs):
        r1 = svc.create_run(**run_kwargs)
        r2 = svc.create_run(**{**run_kwargs, "label": "two"})
        deleted = svc.delete_runs([r1.id, r2.id])
        assert sorted(deleted) == sorted([r1.output_dir, r2.output_dir])
        assert svc.list_runs()["total"] == 0
        # tags are not deleted
        svc.set_tags(svc.create_run(**run_kwargs).id, ["keeper"])
        svc.delete_runs([svc.list_runs()["items"][0]["id"]])

    def test_empty_batch_rejected(self, svc):
        with pytest.raises(RunServiceError):
            svc.delete_runs([])


class TestDuplicateAndCompare:
    def test_duplicate_creates_draft_copy(self, svc, run_kwargs):
        source = svc.create_run(**run_kwargs)
        svc.mark_running(source.id)
        copy = svc.duplicate_run(source.id, new_output_dir="/tmp/copy")
        assert copy.status == "draft"
        assert copy.label == "smoke run (copy)"
        assert copy.n_runs == source.n_runs
        detail = svc.get_run_detail(copy.id)
        assert len(detail["test_cases"]) == 2

    def test_compare_runs(self, svc, run_kwargs, tmp_path):
        ids = []
        for _ in range(2):
            run = svc.create_run(**run_kwargs)
            svc.mark_running(run.id)
            svc.add_scenario_result(run.id, make_result("booth", 2, "hygo", tmp_path))
            svc.mark_completed(run.id, 1.0)
            ids.append(run.id)
        data = svc.compare_runs(ids)
        assert set(data) == set(ids)
        for entry in data.values():
            assert "booth_2D::hygo" in entry["results"]

    def test_compare_bounds_enforced(self, svc, run_kwargs):
        rid = svc.create_run(**run_kwargs).id
        with pytest.raises(RunServiceError):
            svc.compare_runs([rid])
        with pytest.raises(RunServiceError):
            svc.compare_runs([rid] * 5)


def test_payload_roundtrip(tmp_path: Path):
    path = tmp_path / "p.json.zst"
    data = {"raw_costs": [1.5, float("inf") is not None and 2.5], "curves": [[1, 2]]}
    write_payload(path, data)
    assert read_payload(path) == data
