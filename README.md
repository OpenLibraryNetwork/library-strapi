# Library Network Strapi Backend

Central backend service for the Interconnected Lending Libraries system. Provides a shared catalog, copy management, and Biblionet.gr integration for 10-15 lending library branches connected via JavaFX desktop clients.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Data Model](#data-model)
- [API Endpoints](#api-endpoints)
- [Security Model](#security-model)
- [Setup](#setup)
- [Configuration](#configuration)
- [Development](#development)

---

## Overview

This Strapi v4 instance serves as the central authority for:

- **Shared catalog** of publications (books, brochures, periodical issues) across all branches
- **Copy tracking** with per-library ownership and real-time availability
- **Atomic borrow/return** operations with race-condition prevention
- **Biblionet.gr integration** for automatic book metadata retrieval via ISBN
- **Multi-tenant isolation** ensuring each library can only modify its own copies

Local user data and borrow records are stored on each client's encrypted H2 database (GDPR compliance). The Strapi backend holds only shared catalog data.

---

## Architecture

```
+-----------------------------------------------+
|              Strapi v4.16.2                    |
|          (PostgreSQL 14 / SQLite)             |
+-----------------------------------------------+
|  Content Types:                               |
|  - Books (Unified: Book/Brochure/Periodical)  |
|  - Authors                                    |
|  - Publishers                                 |
|  - Magazines (periodical titles)              |
|  - Copies (per-library physical items)        |
|  - Libraries                                  |
+-----------------------------------------------+
|  Custom Logic:                                |
|  - Biblionet API client (ISBN lookup)         |
|  - Atomic borrow/return (Knex SQL)            |
|  - Type validation lifecycle hooks            |
|  - Multi-tenant policy (is-library-owner)     |
+-----------------------------------------------+
         |              |              |
    [REST + JWT]   [REST + JWT]   [REST + JWT]
         |              |              |
   +---------+    +---------+    +---------+
   | JavaFX  |    | JavaFX  |    | JavaFX  |
   | Client  |    | Client  |    | Client  |
   | Branch A|    | Branch B|    | Branch C|
   +---------+    +---------+    +---------+
   | H2 (AES)|    | H2 (AES)|    | H2 (AES)|
   | Users   |    | Users   |    | Users   |
   | Borrows |    | Borrows |    | Borrows |
   +---------+    +---------+    +---------+
```

**Data Distribution:**

| Data | Storage | Rationale |
|------|---------|-----------|
| Publications, Authors, Publishers | Strapi (centralized) | Shared catalog |
| Magazines (titles) | Strapi (centralized) | Shared metadata |
| Copies | Strapi (centralized) | Cross-library availability |
| Libraries | Strapi (centralized) | Branch registry |
| Users (patrons) | H2 (local per client) | GDPR - personal data |
| Borrow records | H2 (local per client) | GDPR - local operations |

---

## Technology Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Strapi | 4.16.2 | Headless CMS / REST API |
| Node.js | 18-20.x | Runtime |
| PostgreSQL | 14+ | Production database |
| SQLite | 3.x | Development database |
| Knex.js | (bundled) | Atomic SQL operations |

---

## Data Model

```
+------------------+       +------------------+       +------------------+
|    MAGAZINE      |       |   BOOK (Entypa)  |       |     AUTHOR       |
+------------------+       +------------------+       +------------------+
| id               |       | id               |       | id               |
| title (required) |<------| magazine (FK)    |   +-->| name (required)  |
| issn (unique)    |  1:N  | title (required) |   |   | firstname        |
| publisher (FK)   |       | type (enum)      |   |   | lastname         |
+------------------+       |   - Book         |   |   | biography        |
                           |   - Brochure     |   |   | biblionetPersonId|
                           |   - Periodical   |   |   +------------------+
                           | isbn (unique)    |   |
                           | subtitle         |   |   M:N (authors <-> books)
                           | yearPublished    |   |
                           | description      |   +---| authors (M:N)    |
                           | summary          |       | publisher (FK)   |----+
                           | pages            |       | copies (1:N)     |    |
                           | language         |       | subjects (M:N)   |-+  |
                           | coverImageUrl    |       | issueNumber      | |  |
                           | binding          |       | biblionetId      | |  |
                           | edition          |       | biblionetCatId   | |  |
                           | dimensions       |       +------------------+ |  |
                           | place            |                            |  |
                           | category         |       +------------------+ |  |
                           | series           |       |    SUBJECT       |<+  |
                           | price            |       +------------------+    |
                           | weight           |       | id               |    |
                           +------------------+       | subjectTitle     |    |
                                    |                 | subjectDDC       |    |
                                    | 1:N             | biblionetSubjId  |    |
                                    v                 | books (M:N)      |    |
                           +------------------+       +------------------+    |
                           |      COPY        |                               |
                           +------------------+       +------------------+    |
                           | id               |       |    PUBLISHER     |<---+
                           | copyNumber       |       +------------------+
                           | isAvailable      |       | id               |
                           | condition (enum) |       | name (required)  |
                           |   - NEW          |       | biblionetCompId  |
                           |   - GOOD         |       | address          |
                           |   - FAIR         |       | phone            |
                           |   - POOR         |       | email            |
                           | publication (FK) |       | website          |
                           | library (FK)     |       +------------------+
                           +------------------+              |
                                                             | 1:N
                           +------------------+              v
                           |    LIBRARY       |       +------------------+
                           +------------------+       |  STRAPI USER     |
                           | id               |       +------------------+
                           | name (required)  |       | id               |
                           | description      |       | username         |
                           | copies (1:N)     |       | email            |
                           +------------------+       | password (hash)  |
                                                      | role (librarian) |
                                                      | library (FK)     |
                                                      +------------------+
```

**Content Types Summary:**

| Content Type | Display Name | Description |
|-------------|-------------|-------------|
| Book | Entypa | Unified publications (books, brochures, periodical issues) |
| Author | Syggrafeis | Authors with optional Biblionet enrichment (biography) |
| Publisher | Ekdotes | Publishers with contact details |
| Magazine | Periodika | Periodical titles (issues stored as Books with type=Periodical) |
| Copy | Antitypa | Physical copies per library branch |
| Subject | Themata DDC | Dewey Decimal Classification subjects (from Biblionet) |
| Library | Vivliothikes | Library branches |

**Type Discrimination (Single Table Inheritance):**

| Field | Book | Brochure | Periodical |
|-------|------|----------|------------|
| isbn | Required | Forced null | Forced null |
| biblionetId | Optional | Forced null | Forced null |
| issueNumber | Forced null | Forced null | Required |
| magazine (relation) | Forced null | Forced null | Required |
| subjects (relation) | Optional | Optional | Optional |

---

## API Endpoints

### Standard CRUD (Strapi core)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/books | List publications (with filters, pagination) |
| GET | /api/books/:id | Get publication by ID |
| POST | /api/books | Create publication |
| GET | /api/copies | List copies |
| POST | /api/copies | Create copy (library forced by lifecycle hook) |
| PUT | /api/copies/:id | Update copy (isAvailable change blocked) |
| DELETE | /api/copies/:id | Delete copy (own library only) |
| GET | /api/authors | List authors |
| GET | /api/publishers | List publishers |
| GET | /api/magazines | List magazine titles |
| GET | /api/subjects | List DDC subjects |
| GET | /api/libraries | List libraries |

### Custom Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/books/search-biblionet?isbn=X | Search ISBN in local DB then Biblionet API (enriches authors, publishers, subjects, cover image) |
| POST | /api/copies/borrow | Atomic borrow (sets isAvailable=false) |
| POST | /api/copies/return | Atomic return (sets isAvailable=true) |

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/local | Login (returns JWT + user with library) |
| GET | /api/users/me | Get current user info |

---

## Security Model

### Authentication
- JWT tokens with 90-day expiry
- Login response includes `user.library` relation (via strapi-server.js extension)
- No public access; all endpoints require valid JWT

### Authorization (Multi-Tenant)

- **Librarian role**: custom role with scoped permissions
- **is-library-owner policy**: enforces `user.library.id == copy.library.id` on write operations
- **Copy lifecycle hooks**:
  - `beforeCreate`: forces `library = authenticated user's library` (ignores client-sent value)
  - `beforeUpdate`: blocks `isAvailable` changes via standard REST (must use borrow/return endpoints)
  - `beforeUpdate`: blocks `library` reassignment

### Borrow/Return Atomicity
- Uses Knex query builder: `UPDATE copies SET is_available = false WHERE id = ? AND is_available = true`
- Returns 409 Conflict if copy already borrowed/returned
- Prevents double-borrow race conditions

### Biblionet API Rate Limiting
- In-memory daily counter (900 calls/day, buffer 100 for admin)
- Auto-resets at midnight
- Dynamic increment based on actual API calls per search (varies: 2-5 calls depending on enrichment needs)
- Calls made: get_title, get_contributors, get_title_subject, get_person (per author), get_company (per publisher)

---

## Setup

### Prerequisites

- Node.js 18.x or 20.x
- npm or yarn
- PostgreSQL 14+ (production) or SQLite (development)

### Installation

```bash
git clone <repository-url>
cd library-strapi
npm install
cp .env.example .env
# Edit .env with your secrets and Biblionet credentials
```

### First Run

```bash
npm run develop
```

1. Open http://localhost:1337/admin
2. Create admin account
3. Create a **Librarian** role (Settings > Users & Permissions > Roles)
4. Create a Library entry
5. Create a user with Librarian role and assign a library
6. The bootstrap script auto-grants permissions to the Librarian role on restart

---

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| HOST | Server host | 0.0.0.0 |
| PORT | Server port | 1337 |
| APP_KEYS | Application keys (comma-separated) | random-base64-strings |
| API_TOKEN_SALT | Salt for API tokens | random-base64 |
| ADMIN_JWT_SECRET | Admin panel JWT secret | random-base64 |
| JWT_SECRET | Users-permissions JWT secret | random-base64 |
| TRANSFER_TOKEN_SALT | Data transfer token salt | random-base64 |
| BIBLIONET_API_URL | Biblionet webservice URL | https://biblionet.gr/webservice |
| BIBLIONET_USER | Biblionet API username | user@example.com |
| BIBLIONET_PASS | Biblionet API password | (secret) |
| DATABASE_CLIENT | Database client (production) | postgres |
| DATABASE_HOST | Database host (production) | 127.0.0.1 |
| DATABASE_PORT | Database port (production) | 5432 |
| DATABASE_NAME | Database name (production) | library_strapi |
| DATABASE_USERNAME | Database user (production) | strapi |
| DATABASE_PASSWORD | Database password (production) | (secret) |

### JWT Configuration

Configured in `config/plugins.js`:

```javascript
module.exports = ({ env }) => ({
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: '90d',
      },
    },
  },
});
```

---

## Development

### Project Structure

```
library-strapi/
├── config/
│   ├── database.js          # Database configuration
│   ├── middlewares.js        # Middleware configuration
│   ├── plugins.js            # Plugin configuration (JWT expiry)
│   └── server.js             # Server configuration
├── src/
│   ├── api/
│   │   ├── author/           # Author content type
│   │   ├── book/             # Publication content type (unified)
│   │   │   ├── content-types/book/
│   │   │   │   ├── schema.json
│   │   │   │   └── lifecycles.js      # Type validation
│   │   │   ├── controllers/book.js    # Biblionet search
│   │   │   ├── routes/
│   │   │   │   ├── book.js            # Core CRUD routes
│   │   │   │   └── custom-book.js     # search-biblionet route
│   │   │   └── services/
│   │   │       ├── biblionet.js       # Biblionet HTTP client (get_title, get_contributors, get_title_subject, get_person, get_company, downloadImage)
│   │   │       └── biblionet-quota.js # Rate limiter
│   │   ├── copy/             # Copy content type
│   │   │   ├── content-types/copy/
│   │   │   │   ├── schema.json
│   │   │   │   └── lifecycles.js      # Tenant isolation + isAvailable block
│   │   │   ├── controllers/copy.js    # Atomic borrow/return
│   │   │   └── routes/
│   │   │       ├── copy.js            # Core CRUD routes
│   │   │       └── custom-copy.js     # borrow/return routes
│   │   ├── library/          # Library content type
│   │   ├── magazine/         # Magazine content type
│   │   ├── publisher/        # Publisher content type
│   │   └── subject/          # Subject DDC content type
│   ├── extensions/
│   │   └── users-permissions/
│   │       ├── content-types/user/schema.json  # Adds library relation
│   │       └── strapi-server.js                # Populates library on login
│   ├── policies/
│   │   └── is-library-owner.js  # Multi-tenant policy
│   └── index.js              # Bootstrap (permissions, API tokens)
├── .env.example              # Environment template
├── package.json
└── yarn.lock
```

### Running in Development

```bash
npm run develop
# or
yarn develop
```

### Database Reset (Development)

```bash
rm -f .tmp/data.db
npm run develop
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run develop` | Start with auto-reload |
| `npm run start` | Start in production mode |
| `npm run build` | Build admin panel |
| `npm run strapi` | Run Strapi CLI commands |
