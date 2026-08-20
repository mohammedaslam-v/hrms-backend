# HRMS Backend

Node.js + TypeScript + Express + raw SQL (MySQL via `mysql2`).

Layered architecture: **Controller → Service → Repository**, with contracts in `src/interfaces/` and dependencies wired by constructor injection in a composition root (`src/container.ts`).

## Structure

```
src/
├── config/          # env loading, MySQL connection pool
├── interfaces/
│   ├── repositories/   # I*Repository contracts (data access)
│   └── services/       # I*Service contracts (business logic)
├── models/          # entities + DTOs
├── controllers/     # HTTP layer: parse/validate requests, shape responses
├── services/        # business rules; depends on repository interfaces
├── repositories/    # raw SQL; depends on the mysql2 pool
├── routes/          # express routers, bound to controllers
├── middlewares/     # error + 404 handlers
├── utils/           # ApiError, asyncHandler
├── container.ts     # composition root (the only place concretions are chosen)
├── app.ts           # express app assembly
└── server.ts        # entrypoint + graceful shutdown
db/
└── schema.sql       # database DDL
```

## Setup

1. `npm install`
2. Create the database: `mysql -u root -p < db/schema.sql`
3. Copy `.env.example` to `.env` and fill in your MySQL credentials
4. `npm run dev`

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled build |
| `npm run typecheck` | Type-check without emitting |

## API

Base URL: `/api/v1`

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Health check (root level) |
| GET | `/employees` | List employees |
| GET | `/employees/:id` | Get one employee |
| POST | `/employees` | Create employee |
| PUT | `/employees/:id` | Update employee |
| DELETE | `/employees/:id` | Delete employee |

Create body (required: `employeeCode`, `firstName`, `lastName`, `email`, `dateOfJoining`):

```json
{
  "employeeCode": "EMP-0001",
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane.doe@example.com",
  "phone": "9999999999",
  "department": "Engineering",
  "designation": "Software Engineer",
  "dateOfJoining": "2026-08-20",
  "status": "active"
}
```

## Adding a new module (e.g. leave, attendance, payroll)

1. Add the table DDL to `db/schema.sql`
2. Define the entity + DTOs in `src/models/`
3. Declare `I<Name>Repository` in `src/interfaces/repositories/` and `I<Name>Service` in `src/interfaces/services/`
4. Implement the repository (raw SQL) in `src/repositories/`
5. Implement the service (business rules) in `src/services/`
6. Implement the controller in `src/controllers/` and a router in `src/routes/`
7. Wire everything in `src/container.ts` and mount the router in `src/routes/index.ts`
