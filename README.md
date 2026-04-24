# DJ Nounoune

DJ Nounoune is a NestJS-based backend application designed for music management and interactive chat experiences. It integrates with various services including MongoDB, Google Gemini (GenAI), Spotify, and MPD (Music Player Daemon).

## 🚀 Features

- **Chat Management**: REST API for creating and managing chatrooms with history.
- **AI Integration**: Integration with Google Gemini for intelligent interactions.
- **Music Services**: Support for Spotify and MPD (Music Player Daemon).
- **CLI Tool**: Built-in command-line interface for administrative tasks.
- **Real-time**: Socket.io support for real-time communication.

## 📋 Requirements

- **Node.js**: v20 or later (v22 recommended)
- **npm**: v10 or later
- **MongoDB**: v6.0 or later (Replica Set configuration recommended)
- **Docker**: For running the MongoDB replica set easily

## 🛠️ Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd dj-nounoune
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Configuration**:
   Create a `.env` file in the root directory and fill in the required variables (see [Environment Variables](#-environment-variables) below).

4. **Start MongoDB**:
   Use the provided Docker Compose file to start a MongoDB replica set:
   ```bash
   docker-compose up -d
   ```

## 💻 Commands

### Start the Backend

```bash
# Development mode
npm run start

# Watch mode (recommended for development)
npm run start:dev

# Debug mode
npm run start:debug

# Production mode
npm run start:prod
```

### CLI Interface

The project includes a CLI for specialized tasks:
```bash
npm run cli
```

### Tests

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# Test coverage
npm run test:cov

# E2E tests
npm run test:e2e
```

### Linting & Formatting

```bash
# Fix linting issues
npm run lint

# Format code with Prettier
npm run format
```

## 🔐 Environment Variables

The application requires the following environment variables:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string (including replica set members) |
| `MONGO_DATABASE` | Name of the MongoDB database |
| `GENAI_API_KEY` | Google Gemini API Key |
| `AUTHX_API_KEY` | API Key for authenticating REST requests |
| `MPD_HOST` | Host address for Music Player Daemon |
| `MPD_PORT` | Port for Music Player Daemon |
| `SPOTIFY_CLIENT_ID` | Spotify Application Client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify Application Client Secret |
| `IMPORT_LIBRARY_PATH_ROOT`| Root path for music library (Local/Windows) |
| `LIBRARY_ROOT_PATH` | Path mapping for music library (Server/Samba) |

## 📁 Project Structure

```text
dj-nounoune/
├── src/
│   ├── cli/            # CLI commands and providers
│   ├── controller/     # REST API controllers
│   ├── gateway/        # Socket.io gateways
│   ├── schemas/        # Mongoose schemas/models
│   ├── services/       # Business logic services
│   ├── utils/          # Utility functions
│   ├── app.module.ts   # Root application module
│   ├── cli.ts          # CLI entry point
│   └── main.ts         # REST API entry point
├── test/               # E2E tests
├── files/              # TODO: Document purpose of this folder
├── docker-compose.yml  # MongoDB Replica Set configuration
└── package.json        # Dependencies and scripts
```

## 📖 Chat API Examples

The Chat REST API requires the `x-api-key` header for authentication. Use the `AUTHX_API_KEY` value.

> **Note:** The `userId` is currently hardcoded to `Alexis-le-Trotteur` on chat creation.

### 1. Create a Chatroom
```bash
curl -X POST http://localhost:3000/chatroom \
  -H "x-api-key: your-secure-api-key" \
  -d '{
    "topic": "My first chatroom",
    "userId": "Alexis-le-Trotteur"
  }'
```

### 2. Get All Chatrooms
```bash
curl -X GET http://localhost:3000/chatrooms \
  -H "x-api-key: your-secure-api-key"
```

### 3. Get a Specific Chatroom

Replace `:id` with the `_id` from the creation step.

```bash
curl -X GET http://localhost:3000/chatroom/:id \
  -H "x-api-key: your-secure-api-key"
```

### 4. Get Chatroom History

Replace `:id` with the `_id` from the creation step.

```bash
curl -X GET http://localhost:3000/chatroom/:id/history \
  -H "x-api-key: your-secure-api-key"
```

### 5. Delete a Chatroom

```bash
curl -X DELETE http://localhost:3000/chatroom/:id \
  -H "x-api-key: your-secure-api-key"
```

## ⚖️ License

This project is **UNLICENSED**. See the [LICENSE](LICENSE) file for details.
