# Error Model

Stage 2 normalizes backend failures into a small set of codes:

- `BACKEND_NOT_FOUND`
- `BACKEND_UNAVAILABLE`
- `BACKEND_NOT_PAIRED`
- `FIGMA_UNAVAILABLE`
- `BACKEND_PROTOCOL_ERROR`
- `BACKEND_TIMEOUT`
- `AMBIGUOUS_ACTIVE_BACKEND`
- `INTERNAL_ERROR`

## Mapping

- Timeout strings map to `BACKEND_TIMEOUT`.
- Port conflicts such as `EADDRINUSE` map to `BACKEND_UNAVAILABLE`.
- Explicit no-plugin messages map to `BACKEND_NOT_PAIRED`.
- Unknown backend protocol failures map to `BACKEND_PROTOCOL_ERROR`.
- Internal coordinator exceptions map to `INTERNAL_ERROR` unless already normalized.

## Response Shape

```json
{
  "ok": false,
  "backend": "plumb",
  "error": {
    "code": "BACKEND_NOT_PAIRED",
    "message": "plumb backend is not paired with Figma.",
    "details": {}
  }
}
```

Backend stderr/original details are preserved in error messages/details when useful for diagnostics.
