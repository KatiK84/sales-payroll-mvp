import streamlit as st
import pandas as pd

from src.excel_loader import load_excel_file
from src.preprocessing import preprocess_payments_report

st.set_page_config(
    page_title="Sales Payroll MVP",
    page_icon="💼",
    layout="wide"
)

st.title("Sales Payroll MVP")
st.subheader("Модуль расчёта зарплаты менеджеров по продажам")
st.write("Тестовая локальная версия: шаги 1–2 — загрузка Excel, нормализация колонок и первичная очистка строк.")

st.markdown("---")
st.header("Загрузка и первичная обработка отчёта по поступлению денежных средств")

uploaded_file = st.file_uploader(
    "Загрузите Excel-файл отчёта",
    type=["xlsx", "xls"]
)

if uploaded_file is None:
    st.info("Пока файл не загружен.")
    st.stop()

try:
    raw_df = load_excel_file(uploaded_file)
except Exception as e:
    st.error(f"Ошибка при чтении файла: {e}")
    st.stop()

st.success("Файл успешно загружен.")

tab1, tab2, tab3 = st.tabs([
    "Исходные данные",
    "После нормализации",
    "Сводка очистки"
])

with tab1:
    st.write("Предпросмотр исходных данных:")
    st.dataframe(raw_df.head(20), use_container_width=True)
    st.write(f"Строк: {raw_df.shape[0]}, колонок: {raw_df.shape[1]}")
    st.write("Исходные названия колонок:")
    st.write(list(raw_df.columns))

clean_df, meta = preprocess_payments_report(raw_df)

with tab2:
    st.write("Предпросмотр после первичной обработки:")
    st.dataframe(clean_df.head(30), use_container_width=True)
    st.write(f"Строк после очистки: {clean_df.shape[0]}, колонок: {clean_df.shape[1]}")
    st.write("Нормализованные названия колонок:")
    st.write(list(clean_df.columns))

with tab3:
    col1, col2, col3 = st.columns(3)
    col1.metric("Исходных строк", meta["initial_rows"])
    col2.metric("Удалено полностью пустых", meta["dropped_empty_rows"])
    col3.metric("Осталось строк", meta["final_rows"])

    st.markdown("### Что делает версия шагов 1–2")
    st.write("- загружает Excel-файл;")
    st.write("- показывает исходные данные;")
    st.write("- нормализует названия колонок;")
    st.write("- удаляет полностью пустые строки;")
    st.write("- чистит текстовые значения;")
    st.write("- пытается привести числовые колонки к числам;")
    st.write("- добавляет технический идентификатор строки report_row_id.")

    st.markdown("### Карта колонок")
    st.json(meta["column_mapping"])

    if meta["numeric_columns_detected"]:
        st.markdown("### Колонки, распознанные как числовые")
        st.write(meta["numeric_columns_detected"])
