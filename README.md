# Master Outline (TOC Editor)

Full-stack Table of Contents editor with:
- FastAPI + PostgreSQL backend
- React + Vite frontend
- Tree rendering, drag reorder (same parent), rename, create, delete, and JSON import

## Project Structure

- `backend/`: FastAPI app and scripts
- `frontend/`: React app (Vite + TypeScript)

## Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- PostgreSQL

## Backend Setup

1. Create and activate a virtual environment:
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create `.env` in `backend/`:
```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<db_name>
TOC_JSON_PATH=study_template.json
LOG_LEVEL=INFO
```

4. Run the API server:
```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Backend runs at `http://127.0.0.1:8000`.

## Frontend Setup

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Start dev server:
```bash
npm run dev
```

Frontend runs at `http://127.0.0.1:5173`.

## Core Features

- View nested TOC tree
- Drag/drop reorder within same parent
- Rename section
- Add sibling / add child
- Delete:
  - `cascade` for parent + descendants
  - `lift_children` for removing node while lifting children
- Import JSON from UI (`Import JSON` button)

## API Endpoints (Summary)

- `GET /sections`: return tree
- `PATCH /sections/{section_id}`: rename
- `POST /sections`: create
- `DELETE /sections/{section_id}?strategy=lift_children|cascade`: delete
- `PUT /sections/move`: reorder/move-by-anchor
- `POST /sections/import`: import from uploaded JSON (or fallback file if none uploaded)
- `POST /sections/import/path`: import from explicit file path

## JSON Import Notes

`/sections/import` accepts a JSON array. Supported fields include:
- `section_key` (or `section_id`)
- `name` (or `section_title`)
- `parent_key`
- `order`

If keys/orders are missing, backend normalizes and validates input before insert.

## Development Notes

- Frontend API base URL is set in `frontend/src/api.ts` (`http://127.0.0.1:8000`).
- CORS is configured for `localhost:5173` and `127.0.0.1:5173` in backend.
