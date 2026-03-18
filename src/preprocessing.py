from __future__ import annotations

import re
from typing import Dict, List, Tuple

import pandas as pd


def _normalize_column_name(name: str, used_names: set[str]) -> str:
    value = str(name).strip().lower()
    value = value.replace("\n", " ")
    value = re.sub(r"\s+", " ", value)
    value = value.replace("%", " percent ")
    value = value.replace("№", " no ")
    value = value.replace("/", " ")
    value = value.replace("-", " ")
    value = re.sub(r"[^a-zA-Zа-яА-Я0-9_ ]", "", value)
    value = value.strip().replace(" ", "_")

    if not value:
        value = "unnamed"

    base = value
    counter = 2
    while value in used_names:
        value = f"{base}_{counter}"
        counter += 1

    used_names.add(value)
    return value


def normalize_columns(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, str]]:
    used_names: set[str] = set()
    mapping: Dict[str, str] = {}

    for col in df.columns:
        mapping[str(col)] = _normalize_column_name(str(col), used_names)

    normalized = df.rename(columns=mapping).copy()
    return normalized, mapping


def _clean_cell(value):
    if pd.isna(value):
        return None

    if isinstance(value, str):
        cleaned = value.strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned if cleaned else None

    return value


def clean_cells(df: pd.DataFrame) -> pd.DataFrame:
    cleaned = df.copy()
    for col in cleaned.columns:
        cleaned[col] = cleaned[col].map(_clean_cell)
    return cleaned


def drop_fully_empty_rows(df: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
    before = len(df)
    result = df.dropna(how="all").copy()
    dropped = before - len(result)
    return result, dropped


def detect_and_convert_numeric_columns(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    converted = df.copy()
    numeric_columns_detected: List[str] = []

    for col in converted.columns:
        series = converted[col]

        if series.dropna().empty:
            continue

        sample = series.dropna().astype(str).head(20)

        looks_numeric = 0
        for val in sample:
            candidate = val.replace(".", "").replace(",", ".").replace(" ", "")
            if __import__("re").fullmatch(r"-?\d+(\.\d+)?", candidate):
                looks_numeric += 1

        if looks_numeric >= max(3, len(sample) // 2):
            converted[col] = pd.to_numeric(
                series.astype(str).str.replace(".", "", regex=False).str.replace(",", ".", regex=False).str.replace(" ", "", regex=False),
                errors="coerce"
            )
            numeric_columns_detected.append(col)

    return converted, numeric_columns_detected


def add_report_row_id(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    result.insert(0, "report_row_id", range(1, len(result) + 1))
    return result


def preprocess_payments_report(df: pd.DataFrame):
    initial_rows = len(df)

    normalized_df, column_mapping = normalize_columns(df)
    cleaned_cells_df = clean_cells(normalized_df)
    non_empty_df, dropped_empty_rows = drop_fully_empty_rows(cleaned_cells_df)
    numeric_df, numeric_columns_detected = detect_and_convert_numeric_columns(non_empty_df)
    final_df = add_report_row_id(numeric_df)

    meta = {
        "initial_rows": initial_rows,
        "dropped_empty_rows": dropped_empty_rows,
        "final_rows": len(final_df),
        "column_mapping": column_mapping,
        "numeric_columns_detected": numeric_columns_detected,
    }

    return final_df, meta
