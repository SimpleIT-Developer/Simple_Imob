# Imobiliária Simples

## Overview

Imobiliária Simples is a property management web application (MVP) designed for small real estate agencies. It provides comprehensive tools for managing properties, landlords, tenants, service providers, contracts, receipts, cash transactions, landlord transfers, and invoice generation. The application uses a modern full-stack architecture with React frontend and Express backend, connected to a PostgreSQL database.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state, React Context for auth state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Build Tool**: Vite with HMR support

The frontend follows a page-based structure where each module (properties, landlords, tenants, etc.) has its own page component under `client/src/pages/`. Common UI components live in `client/src/components/ui/` following shadcn/ui patterns.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Authentication**: Session-based auth using express-session with bcrypt password hashing
- **API Design**: RESTful API endpoints under `/api/` prefix

The backend uses a layered architecture:
- `server/routes.ts` - API route definitions and middleware
- `server/storage.ts` - Data access layer (repository pattern)
- `server/db.ts` - Database connection pool
- `server/providers/` - Mock integrations for PIX payments and invoice generation

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` (shared between frontend and backend)
- **Migrations**: Generated via `drizzle-kit push` command

Key entities: Users, Landlords, Tenants, ServiceProviders, Properties, Contracts, Services, Receipts, CashTransactions, LandlordTransfers, Invoices

### Authentication
- Session-based authentication with express-session
- Passwords hashed with bcrypt
- Admin user auto-seeded on first boot (admin@admin.com / Admin@123)
- Protected routes use `requireAuth` middleware

### External Integrations
Mock providers are implemented for:
- **PIX Transfers** (`MockPixProvider.ts`) - Simulates Brazilian instant payment system for landlord transfers
- **Invoice Generation** (`MockNfProvider.ts`) - Simulates nota fiscal (Brazilian invoice) generation

## External Dependencies

### Database
- **PostgreSQL**: Primary database (connection via `DATABASE_URL` environment variable)
- **Drizzle ORM**: Type-safe database queries and schema management

### UI Framework
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, forms, etc.)
- **shadcn/ui**: Pre-styled component library built on Radix
- **Tailwind CSS**: Utility-first CSS framework

### Key Libraries
- **TanStack React Query**: Server state management and caching
- **Zod**: Schema validation (with drizzle-zod for database schema types)
- **bcrypt**: Password hashing
- **express-session**: Session management
- **date-fns**: Date manipulation

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Secret key for session encryption (optional, has default)