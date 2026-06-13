# TedBuy Agent Registration & Discovery Metadata

Thank you for visiting TedBuy Ghana. We provide first-class classified listings with secure verification, video-commerce ads, and direct communication in Ghana.

## Agent Authentication Workflow

To interact with TedBuy APIs, follow these specifications:

1. **Self-Registration (RFC 9728 & OAuth 2.0)**:
   - Registration URI: `https://www.tedbuy.store/api/agents/register`
   - Authentication Type: Public OAuth 2.0 Dynamic Client Registration.
   - Resource Scopes: `public`, `read`.

2. **Accessing Listings**:
   - Access token should be passed as a standard Bearer token in the `Authorization` header: `Authorization: Bearer <token>`.
   - Anonymous read queries do not require authorization.

3. **Inbound Support**:
   - For queries or complaints regarding agent activity, please contact the administrators at `admin@tedbuy.store`.
