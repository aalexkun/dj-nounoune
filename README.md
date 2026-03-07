## Start the Backend

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev
```

## Chat API Examples

The Chat REST API requires the `x-api-key` header for authentication. Make sure the `AUTHX_API_KEY` environment variable is set.

> **Note:** The `userId` is hardcoded to `Alexis-le-Trotteur` on chat creation for now.

### 1. Create a Chatroom

```bash
curl -X POST http://localhost:3000/chatroom \
  -H "x-api-key: your-secure-api-key" \
  -d '{
    "topic": "My first chatroom",
    "userId": "Alexis-le-Trotteur"
  }'
```

**Response:**
```json
{
  "userId": "Alexis-le-Trotteur",
  "topic": "My first chatroom",
  "history": [],
  "_id": "64a2b1c3e4d5f6g7h8i9j0k1",
  "createdAt": "2023-10-27T10:00:00.000Z",
  "updatedAt": "2023-10-27T10:00:00.000Z",
  "__v": 0
}
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
