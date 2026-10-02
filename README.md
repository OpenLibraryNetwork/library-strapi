# Open Library Network — Strapi Backend

The central backend of the Open Library Network, a small network of lending libraries that share one union catalogue. It holds the shared catalogue, the copies each library owns, and their availability; it imports bibliographic records from Biblionet and the National Library of Greece; it enforces the cataloguing rules; and it serves the librarians' desktop application and the public website.

---

## Table of Contents

- [Overview](#overview)
- [Position in the System](#position-in-the-system)
- [Technology Stack](#technology-stack)
- [Data Model](#data-model)
- [Catalogue Consistency](#catalogue-consistency)
- [Access and API](#access-and-api)
- [Security Model](#security-model)
- [External Services](#external-services)
- [Setup](#setup)
- [Configuration](#configuration)
- [Development](#development)
- [License](#license)

---

## Overview

This Strapi 5 instance is the single source of truth for:

- **The union catalogue**: books, brochures and magazine issues, shared by every library of the network, with their contributors (persons in roles such as author or translator), publishers, subjects and magazines.
- **Record import**: books by ISBN from [Biblionet](https://biblionet.gr), magazines by ISSN from the catalogue of the National Library of Greece.
- **Local cataloguing**: libraries can register publications, persons, publishers and magazines that no external source knows, with automatic duplicate detection; these records wait in a review queue.
- **Catalogue maintenance**: a cataloguer role in the admin panel reviews local records, corrects them and merges duplicates.
- **Copies and loans**: each library owns its copies; borrow and return are atomic, and a library can only change its own copies.
- **The public catalogue API** (`/api/catalog`), through which the public website reads the catalogue with server-side filtering and paging.

---

## Position in the System

```
                         +-----------------------------------+
                         |     Strapi backend (this repo)    |
                         |   union catalogue, copies, loans  |
                         +-----------------------------------+
                            ^                         ^
            REST + JWT      |                         |   REST + API token
          (per librarian)   |                         |   ("frontend", read only)
                            |                         |
              +-------------+----------+    +---------+-----------------+
              |   Desktop application  |    |     Public Catalogue      |
              |   JavaFX, one per      |    |  Astro, server-rendered   |
              |   library branch       |    |  (+ JSON API for Android) |
              +------------------------+    +---------------------------+
              | local H2 database:     |
              | patrons, loan records  |
              +------------------------+
```

| Repository | Role |
|------------|------|
| [library-strapi](https://github.com/OpenLibraryNetwork/library-strapi) | This repository: the shared catalogue and its API. |
| [LibraryManagementSystemDesktopApp](https://github.com/OpenLibraryNetwork/LibraryManagementSystemDesktopApp) | JavaFX desktop application for librarians: cataloguing, copies, patrons and loans. |
| [oln-astro-frontend](https://github.com/OpenLibraryNetwork/oln-astro-frontend) | The public website and its JSON API for the Android app. |

**Where data lives:**

| Data | Storage | Rationale |
|------|---------|-----------|
| Publications, persons, publishers, magazines, subjects | Strapi | Shared catalogue |
| Copies and their availability | Strapi | Availability across the network |
| Libraries and their contact details | Strapi | Network registry, shown on the public site |
| Librarian accounts | Strapi (users-permissions) | Authentication, library assignment |
| Patrons and loan records | H2, local to each desktop client | Personal data stays at the branch |

---

## Technology Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Strapi | 5.56 | Headless CMS, REST API, admin panel |
| Node.js | 24 (engines: 22 to 26) | Runtime |
| SQLite | bundled (better-sqlite3) | Development and test database |
| PostgreSQL | 14 | Production database (`docker-compose.yml`) |
| Jest + supertest | 29 / 6 | Unit and integration tests |
| Docker | `node:24-alpine` | Production image (Yarn build, no package manager at run time) |

---

## Data Model

```
+--------------------+        +-------------------------+        +-------------------+
|     MAGAZINE       |        |   BOOK  (publication)   |        |      PERSON       |
+--------------------+  1:N   +-------------------------+        +-------------------+
| title, qualifier   |<-------| magazine                |        | name, qualifier   |
| issn (unique)      |        | type: Βιβλίο |          |        | firstname,        |
| place, periodicity |        |   Μπροσούρα | Περιοδικό |        | middlename,       |
| nlgBiblionumber    |        | title, subtitle, isbn   |        | lastname          |
| publisher          |        | issueNumber,            |        | bornYear,         |
| reviewed,          |        | publicationMonthYear,   |        | deathYear,        |
| catalogedBy,       |        | issueOrder (private)    |        | biography         |
| mergeInto          |        | yearPublished, pages,   |        | biblionetPersonId |
+--------------------+        | language, series, ...   |        | reviewed,         |
                              | contributors[] ---------+------->| catalogedBy,      |
+--------------------+        |   { person, role }      |        | mergeInto         |
|     PUBLISHER      |  1:N   | publisher               |        +-------------------+
+--------------------+<-------| subjects (M:N)          |
| name, qualifier,   |        | biblionetId             |        +-------------------+
| alternativeName    |        | reviewed, catalogedBy,  |        | CONTRIBUTOR ROLE  |
| address, phone,    |        | mergeInto               |        +-------------------+
| email, website     |        | searchKey, matchKey     |        | name              |
| biblionetCompanyId |        |   (private)             |        | biblionetTypeId   |
| reviewed, ...      |        +-------------------------+        | ("1" = author)    |
+--------------------+                    | 1:N                  +-------------------+
                                          v
+--------------------+        +-------------------------+        +-------------------+
|      LIBRARY       |  1:N   |          COPY           |        |      SUBJECT      |
+--------------------+<-------+-------------------------+        +-------------------+
| name, description  |        | copyNumber, isAvailable |        | subjectTitle      |
| address, email,    |        | condition: NEW | GOOD | |        | subjectDDC        |
| phone, website     |        |   FAIR | POOR           |        | biblionetSubjectId|
+--------------------+        | publication, library    |        +-------------------+
          ^                   +-------------------------+
          | N:1
+--------------------+
| USER (librarian)   |
| users-permissions, |
| + library          |
+--------------------+
```

**Content types:**

| Content type | Admin name | Description |
|--------------|-----------|-------------|
| `book` | Έντυπα | All publications in one type: books, brochures and magazine issues |
| `person` | Πρόσωπα | Persons who contribute to publications |
| `contributor-role` | Ρόλοι συντελεστών | Roles such as author or translator, identified by their Biblionet type id |
| `catalog.contributor` (component) | Συντελεστής | One line of a publication's contributor list: a person in a role |
| `publisher` | Εκδότες | Publishers, with contact details |
| `magazine` | Περιοδικά | Magazine titles; their issues are `book` records of type `Περιοδικό` |
| `subject` | Θέματα DDC | Dewey Decimal Classification subjects (from Biblionet) |
| `copy` | Αντίτυπα | Physical copies, each owned by one library |
| `library` | Βιβλιοθήκες | Library branches, with public contact details |

**Rules per publication type** (enforced by lifecycle hooks):

| Field | Βιβλίο (book) | Μπροσούρα (brochure) | Περιοδικό (issue) |
|-------|---------------|----------------------|-------------------|
| `isbn` | Required | Not allowed | Not allowed |
| `biblionetId` | Optional | Not allowed | Not allowed |
| `magazine` | Not allowed | Not allowed | Required |
| `issueNumber` / `publicationMonthYear` | Not allowed | Not allowed | At least one required |

An issue's title is always its magazine's title. `issueOrder` is a numeric sort key computed from the issue number (`"τχ. 05"` gives 5, `"12-13"` gives 12, no number gives 0); it is never part of an API response.

---

## Catalogue Consistency

- **Search keys.** Every person, publisher, magazine and publication has a private `searchKey`: its text normalised to lower case without accents. All searches match every word of the query against it, so `"λοιζιδη"` finds `"Λοϊζίδη"`.
- **Duplicates are blocked.** A private `matchKey` identifies a record (for example, name plus qualifier for a person, or magazine plus issue number for an issue). Creating or editing a record into an existing key is refused, with the existing record returned as a candidate.
- **Homonyms** are told apart by a `qualifier` (for example a birth year), shown as "name (qualifier)".
- **Local records** created by a library carry `reviewed = false` and `catalogedBy` = that library; they are visible at once, and a cataloguer reviews them later.
- **Merges.** A cataloguer merges a duplicate by setting its `mergeInto` field in the admin panel. Strapi moves every reference to the target (contributor lines, publications and magazines of a publisher, copies of a publication with renumbering, issues of a magazine), copies over missing external identifiers, and deletes the duplicate. A publication imported from Biblionet is never merged away, and two records that both come from Biblionet or the National Library are never merged with each other.
- **Delete protection.** A record still referenced by others cannot be deleted; it has to be merged instead.

---

## Access and API

### Who can do what

| Caller | Authentication | Access |
|--------|----------------|--------|
| Public (anonymous) | none | Login only. No catalogue data. |
| Librarian (`librarian` role) | JWT from `POST /api/auth/local` | Reads the catalogue, imports and creates records, manages its own library's copies, borrows and returns. Cannot edit or delete shared records. |
| Cataloguer (admin panel role `Καταλογογράφος`) | Admin panel login | Corrects, merges and deletes catalogue records; reads libraries and copies. |
| `frontend` API token | `Authorization: Bearer <token>` | Read only: single records and the `/api/catalog` lists. Used by the public website, on its server. |
| `scraper` API token | `Authorization: Bearer <token>` | Reads the catalogue and creates or updates records (no deletes), for import scripts. |

The permissions of the `librarian` and public roles and of both API tokens are defined in `src/bootstrap/permissions.js` and re-applied at every start, so they cannot drift.

### Librarian endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/books/search?q=&type=` | Search publications (up to 20) |
| POST | `/api/books/isbn-lookup` | Find a book by ISBN: in the catalogue first, then in Biblionet (imported with its contributors, publisher, subjects and cover) |
| POST | `/api/books/local` | Register a publication locally (a book is looked up in Biblionet first) |
| GET | `/api/persons/search?q=` | Search persons |
| GET | `/api/persons/authors` | Authors with copies in the librarian's library |
| POST | `/api/persons/local` | Register a person locally |
| GET | `/api/publishers/search?q=` | Search publishers |
| GET | `/api/publishers/in-library` | Publishers with copies in the librarian's library |
| POST | `/api/publishers/local` | Register a publisher locally |
| POST | `/api/magazines/issn-lookup` | Find a magazine by ISSN: in the catalogue first, then at the National Library of Greece |
| POST | `/api/magazines/local` | Register a magazine locally |
| GET | `/api/magazines/search?q=` | Search magazines |
| GET | `/api/magazines/in-library` | Magazines with issues in the librarian's library |
| POST | `/api/copies/borrow` | Borrow a copy (atomic) |
| POST | `/api/copies/return` | Return a copy (atomic) |
| GET, POST, PUT, DELETE | `/api/copies` | The library's own copies (create, edit, delete) |
| GET | `/api/books`, `/api/persons`, ... | Standard Strapi reads of every catalogue type |

Local registration answers 409 with the existing records as `candidates` when the record is a duplicate. Searches need at least 2 characters.

### Public catalogue API (`frontend` token)

Every list is filtered, sorted and paginated here (`page`, `pageSize` from 1 to 100, default 24), and every record carries only the fields the website shows.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/catalog/publications` | Publication cards. Filters: `q`, `type`, `library`, `available`, `person`, `role` (with `person`), `publisher`, `magazine`. Availability per library is computed here; with `person`, the counts per role are included |
| GET | `/api/catalog/search-counts?q=` | Counts for the website's search tabs |
| GET | `/api/catalog/persons?q=` | Persons, alphabetical |
| GET | `/api/catalog/publishers?q=` | Publishers, alphabetical |
| GET | `/api/catalog/magazines?q=` or `?publisher=` | Magazines, alphabetical |
| GET | `/api/catalog/libraries?compact=true` | Libraries; `compact` returns names only |

Invalid parameters answer 400 with a message in Greek. A library filter with `available=true` and a person filter with `role` apply to the same copy and the same contributor line respectively.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/local` | Login; the response includes the user's role type and library |
| GET | `/api/users/me` | Current user |

---

## Security Model

- **Accounts.** Librarians are created by an administrator. Public registration is closed, and the public role loses the register, password reset, email confirmation and third-party login endpoints at every start.
- **Tokens.** User JWTs are valid for 90 days. The login endpoint is rate-limited per client IP; behind a reverse proxy, set `TRUST_PROXY=true` so that the limit counts visitors, not the proxy.
- **Tenant isolation.** The `is-library-owner` policy and the copy lifecycle hooks ensure that a librarian creates copies only for their own library, changes or deletes only their own library's copies, cannot move a copy to another library, and cannot change availability except through borrow and return.
- **Atomic borrow and return.** Availability changes with a single conditional update, so two simultaneous loans of the same copy cannot both succeed (the second receives 409).
- **No anonymous reads.** The catalogue is readable only with a librarian JWT or an API token; the public website reads it server-side with the `frontend` token.
- **API tokens** defined in `src/bootstrap/permissions.js` are created, or brought back to exactly their permissions, at every start, without changing their keys. With `ENCRYPTION_KEY` set, an administrator can view a token's value in the admin panel.

---

## External Services

| Service | Used for | Notes |
|---------|----------|-------|
| Biblionet web service | Book import by ISBN | Credentials in `BIBLIONET_USER` / `BIBLIONET_PASS`. In-memory quota of 900 calls per day (100 kept free for the account's other use), reset at midnight; an exhausted quota answers 429, an unreachable service 502. |
| National Library of Greece (Koha catalogue) | Magazine import by ISSN | Public catalogue endpoints, called only from the server with a 10-second timeout and an identifying User-Agent. When the service does not answer, the librarian registers the magazine locally. |

---

## Setup

### Prerequisites

- Node.js 24 (any version from 22 to 26)
- npm or Yarn
- SQLite needs nothing; PostgreSQL 14 for production

### Installation

```bash
git clone git@github.com:OpenLibraryNetwork/library-strapi.git
cd library-strapi
npm install
cp .env.example .env
```

Edit `.env`: generate fresh secrets and add the Biblionet credentials.

### First run

```bash
npm run develop
```

At every start the bootstrap creates or updates:

- the `librarian` role and its permissions, and the closed public role;
- the default contributor roles (author, translator);
- the `Καταλογογράφος` admin role;
- the `frontend` and `scraper` API tokens;
- the sort key of magazine issues catalogued before it existed.

Then, in the admin panel at `http://localhost:1337/admin`:

1. Create the administrator account.
2. Create the libraries of the network (Content Manager > Βιβλιοθήκες), with their contact details.
3. Create a user for each librarian (Content Manager > User) with the `librarian` role and their library.
4. Invite cataloguers (Settings > Users) with the `Καταλογογράφος` role.
5. Copy the value of the `frontend` API token (Settings > API Tokens) into the public website's configuration.

---

## Configuration

### Environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `HOST`, `PORT` | Listen address | `0.0.0.0`, `1337` |
| `PUBLIC_URL` | Public URL of the server, when served under a path | `https://example.org/strapi` |
| `APP_KEYS` | Application keys (comma-separated) | random strings |
| `API_TOKEN_SALT` | Salt for API tokens | random string |
| `ADMIN_JWT_SECRET` | Admin panel JWT secret | random string |
| `JWT_SECRET` | Users-permissions JWT secret | random string |
| `TRANSFER_TOKEN_SALT` | Data transfer token salt | random string |
| `ENCRYPTION_KEY` | Lets administrators view API token values | random string |
| `TRUST_PROXY` | `true` only behind the production reverse proxy | `false` |
| `BIBLIONET_API_URL` | Biblionet web service URL | `https://biblionet.gr/webservice` |
| `BIBLIONET_USER`, `BIBLIONET_PASS` | Biblionet credentials | (secret) |
| `NLG_CATALOGUE_URL` | National Library catalogue (optional) | `https://catalogue.nlg.gr` |
| `NLG_TIMEOUT_MS` | Timeout of a National Library call (optional) | `10000` |
| `DATABASE_CLIENT` | `sqlite` (default) or `postgres` | `postgres` |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` | PostgreSQL connection | |
| `DATABASE_SSL` and `DATABASE_SSL_*` | PostgreSQL TLS options | `false` |

### JWT lifetime

Set in `config/plugins.js` (`users-permissions.config.jwt.expiresIn`, currently `90d`).

---

## Development

### Project structure

```
library-strapi/
├── config/                    # Server, database, middlewares, plugins (JWT), admin, API limits
├── database/migrations/
├── docs/
│   └── cataloguer-checklist.md   # Manual test checklist for the cataloguer role
├── src/
│   ├── api/
│   │   ├── book/              # Publications: ISBN import (Biblionet client, mapper, quota), local registration, search
│   │   ├── catalog/           # Public catalogue API (controller and routes only)
│   │   ├── contributor-role/
│   │   ├── copy/              # Copies: tenant isolation lifecycle, atomic borrow/return
│   │   ├── library/
│   │   ├── magazine/          # Magazines: ISSN import (National Library client and mapper), local registration
│   │   ├── person/
│   │   ├── publisher/
│   │   └── subject/
│   ├── bootstrap/             # Roles, permissions, API tokens, closed registration, issue sort keys
│   ├── components/catalog/    # The contributor component
│   ├── extensions/users-permissions/   # Library on users; role and library in the login response
│   ├── policies/              # is-library-owner
│   ├── utils/                 # Search and match keys, merges, lifecycles, catalogue query and cards, ISBN/ISSN
│   └── index.js               # Register and bootstrap
├── tests/
│   ├── unit/
│   ├── integration/           # Each file boots Strapi on a temporary SQLite database
│   └── helpers/
├── Dockerfile, docker-compose.yml, Makefile
└── .env.example
```

### Running

```bash
npm run develop
```

The admin panel is at `http://localhost:1337/admin`, the API at `http://localhost:1337/api`.

### Tests

```bash
npm test
```

Tests run in band; each integration test file starts Strapi on its own temporary SQLite database. Some of them also write **contract fixtures**, real API responses with stable identifiers, into the other two repositories, whose tests then check that they can read them. The paths are relative: the suite expects the checkouts side by side in one parent directory, named `library-strapi`, `LibraryManagementSystemDesktopApp` (fixtures in `src/test/resources/strapi-fixtures/`) and `library-frontend` (fixtures in `src/lib/__fixtures__/`).

### Docker

```bash
make build     # docker build -t <DOCKER_REPOSITORY>:<version from package.json>
make push
make dev       # docker compose up: PostgreSQL 14 for local use
```

The image builds with Yarn (`yarn.lock`). Dependency pins are kept twice in `package.json`, as `resolutions` (Yarn) and `overrides` (npm): change both together. The runtime stage contains no package manager and runs `strapi start` as the `node` user.

### Database reset (development)

```bash
rm -f .tmp/data.db
npm run develop
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run develop` | Start with auto-reload |
| `npm run start` | Start in production mode |
| `npm run build` | Build the admin panel |
| `npm run strapi` | Strapi CLI |
| `npm test` | All tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |

---

## License

Released under the [MIT License](LICENSE).
