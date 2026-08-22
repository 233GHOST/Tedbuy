---
agent_auth:
  register_uri: "https://tedbuy.store/api/agents/register"
  supported_identity_types:
    - "individual"
    - "organisation"
  credential_types:
    - "api_key"
    - "oauth2"
  scopes_supported:
    public: "General read-only access to browse active listings"
    read: "Access to verified user messages, favorites, and profile status"
    write: "Ability to post, edit, or delete listings, and send real-time chat requests"
---

# TedBuy Agent Registration & Discovery Metadata (auth.md)

Welcome, AI Agent or autonomous explorer. This document outlines the protocols, credentials, discovery pathways, and registration frameworks for agents on TedBuy Ghana.

## 1. Agent Discovery & DNS-AID Configuration
To facilitate automatic agent-to-agent (A2A) and agent-to-service discovery, the following DNS for AI Discovery (DNS-AID) records are published and maintained under the `tedbuy.store` zone.

All discovery zones are signed with **DNSSEC** (DNS Security Extensions) to ensure authenticity and integrity for validating resolvers.

```dns
; DNS-AID Records for TedBuy Discovery (RFC 9460 / draft-mozleywilliams-dnsop-dnsaid)
_index._agents.tedbuy.store.  3600  IN  HTTPS  1  . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="https://tedbuy.store/.well-known/jwks.json" service-doc="https://tedbuy.store/auth.md" api-catalog="https://tedbuy.store/.well-known/api-catalog"
_a2a._agents.tedbuy.store.    3600  IN  HTTPS  1  . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="https://tedbuy.store/.well-known/jwks.json" service-doc="https://tedbuy.store/auth.md" api-catalog="https://tedbuy.store/.well-known/api-catalog"
```

## 2. API Catalog & Endpoint Navigation
Agents can query the standard platform API catalog at any time:
* URL: `https://tedbuy.store/.well-known/api-catalog`
* Key Capabilities:
  - System Health: `GET /api/health`
  - Dynamic JPG optimization: `GET /api/products/:productId/image`
  - Automated Welcome Email: `POST /api/send-welcome-email`

## 3. OAuth Protected Resource Metadata
TedBuy publishes OAuth protected resource parameters following standard RFC 9728 guidelines at `/.well-known/oauth-protected-resource`.
* Resource Identifier: `https://tedbuy.store`
* Scopes Supported: `public`, `read`, `write`
* Token Issuer: `https://tedbuy.store`

## 4. Agent Registration & Authentication Flow
Autonomous agents can register and obtain OAuth2 tokens or secure API key credentials to act on behalf of verified users.

Here is the machine-readable `agent_auth` block for automatic parsing:

```yaml
agent_auth:
  register_uri: "https://tedbuy.store/api/agents/register"
  supported_identity_types:
    - "individual"
    - "organisation"
  credential_types:
    - "api_key"
    - "oauth2"
  scopes_supported:
    public: "General read-only access to browse active listings"
    read: "Access to verified user messages, favorites, and profile status"
    write: "Ability to post, edit, or delete listings, and send real-time chat requests"
```

### Identity Verification Process
When making API requests, the agent must assert its identity in one of the following ways:

1. **OAuth 2.0 Bearer Token**:
   Provide the user-authorized access token in the `Authorization` header:
   ```http
   Authorization: Bearer <access_token>
   ```

2. **Secure JWT Assertion (ID-JAG)**:
   Include a signed JSON Web Token (JWT) in the `X-Agent-Identity` header signed by the agent's private key registered during dynmamic registration:
   ```http
   X-Agent-Identity: <signed_jwt>
   ```
   The platform will verify this JWT against the public key advertised in the agent's published custom JWKS endpoint.

3. **Inbound Support & Queries**:
   For abuse reporting, rate-limiting adjustments, or technical inquiries, contact platforms admins at `admin@tedbuy.store`.
