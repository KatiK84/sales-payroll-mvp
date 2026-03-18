import pandas as pd


def load_excel_file(uploaded_file) -> pd.DataFrame:
    """Reads an uploaded Excel file into a DataFrame."""
    return pd.read_excel(uploaded_file)
