# DNS for AI Discovery (DNS-AID) Configuration Guide

This guide describes how to configure the `_index._agents` DNS records for `tedbuy.store` (or any custom domain) in your DNS provider's settings to satisfy RFC 9460 (SVCB/HTTPS records) and the DNS-AID specification for autonomous AI agent discovery.

---

## 1. DNS Record Configuration Overview

To allow AI agents to automatically discover TedBuy's agent-ready APIs, schemas, and authentication policies from the domain name alone, you need to publish **HTTPS** (ServiceMode) resource records under the `_agents` subdomain.

### Recommended DNS RR Zone File Entries:

```zone
; DNS-AID ServiceMode Records for TedBuy Discovery (RFC 9460)
_index._agents.tedbuy.store.    3600  IN  HTTPS  1  . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="https://tedbuy.store/.well-known/jwks.json" service-doc="https://tedbuy.store/auth.md" api-catalog="https://tedbuy.store/.well-known/api-catalog"
_a2a._agents.tedbuy.store.      3600  IN  HTTPS  1  . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="https://tedbuy.store/.well-known/jwks.json" service-doc="https://tedbuy.store/auth.md" api-catalog="https://tedbuy.store/.well-known/api-catalog"
```

---

## 2. Setting Up Records in Popular DNS Providers

Different DNS providers have different web interfaces for adding `HTTPS` (type 65) or standard service records. Below are step-by-step instructions.

### Option A: Cloudflare (HTTPS Record Support)

Cloudflare natively supports adding `HTTPS` record types:

1. Log in to your Cloudflare Dashboard and select the **tedbuy.store** dome.
2. Navigate to **DNS** -> **Records**.
3. Click **Add record** and configure style as follows:
   - **Type**: `HTTPS`
   - **Name**: `_index._agents` (or `_a2a._agents`)
   - **TTL**: `Auto` or `3600` (1 hour)
   - **Priority**: `1`
   - **Target**: `.` (or `tedbuy.store`)
   - **Value / Parameters**:
     ```text
     alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="https://tedbuy.store/.well-known/jwks.json" service-doc="https://tedbuy.store/auth.md" api-catalog="https://tedbuy.store/.well-known/api-catalog"
     ```
4. Click **Save**.

### Option B: Route 53 (AWS)

AWS Route 53 allows adding `HTTPS` records directly:

1. Open the Route 53 Console and go to **Hosted zones**.
2. Select your domain zone.
3. Click **Create record**:
   - **Record name**: `_index._agents`
   - **Record type**: `HTTPS - Service parameter record`
   - **Value**:
     ```text
     1 . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="https://tedbuy.store/.well-known/jwks.json" service-doc="https://tedbuy.store/auth.md" api-catalog="https://tedbuy.store/.well-known/api-catalog"
     ```
   - **TTL**: `3600`
4. Click **Create records**.

---

## 3. Security Hardening with DNSSEC

To ensure autonomous agents can verify the authenticity and integrity of dynamic discovery parameters (preventing DNS cache poisoning or tampering), your DNS zone **MUST** be signed using DNSSEC.

1. Navigate to your DNS provider's dashboard (e.g., Cloudflare, Route53, Namecheap).
2. Enable the **DNSSEC** setting.
3. Retrieve the DS (Delegation Signer) record details issued by your DNS provider:
   - **Key Tag**
   - **Algorithm**
   - **Digest Type**
   - **Digest**
4. Paste these DS record details into your domain registrar's settings (e.g., Domain.com, GoDaddy) to establish a trusted chain of custody.

---

## 4. Querying and Verifying the Configuration

Once the DNS records propagation period has elapsed, you can verify your agent-readiness using terminal tools like `dig` or direct request tools:

### DNS Query:
```bash
dig _index._agents.tedbuy.store HTTPS
```

### Expected Output:
```text
;; ANSWER SECTION:
_index._agents.tedbuy.store. 3600 IN HTTPS 1 . alpn="h2,h3" port="443" ipv4hint="216.58.210.14" key_uri="https://tedbuy.store/.well-known/jwks.json" service-doc="https://tedbuy.store/auth.md" api-catalog="https://tedbuy.store/.well-known/api-catalog"
```
