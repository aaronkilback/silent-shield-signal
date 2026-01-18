# Fortress Intellectual Property & Trade Secrets

**Document Classification:** CONFIDENTIAL - INTERNAL USE ONLY  
**Last Updated:** January 18, 2026  
**Document Owner:** Ember Leaf Security Inc.

---

## 1. Overview

This document identifies and classifies the intellectual property (IP), trade secrets, and proprietary technologies that constitute the core competitive advantages of the Fortress Security Intelligence Platform.

---

## 2. Proprietary Technology

### 2.1 Core Platform Components

| Component | Classification | Description |
|-----------|---------------|-------------|
| FORTRESS AI Engine | Trade Secret | Multi-model AI orchestration system using Gemini/GPT-5 for threat analysis |
| Signal Processing Pipeline | Trade Secret | Automated ingestion, normalization, and correlation of intelligence signals |
| Entity Correlation Engine | Trade Secret | Real-time entity extraction and relationship mapping algorithms |
| Autonomous SOC Framework | Proprietary | Self-managing security operations with human-in-the-loop escalation |
| AI Agent Architecture | Trade Secret | Specialized AI agents with defined personas, tools, and capabilities |

### 2.2 AI/ML Innovations

| Innovation | Status | Description |
|------------|--------|-------------|
| Anticipation Index Algorithm | Trade Secret | Predictive threat scoring based on signal patterns and entity behavior |
| Confidence Calibration System | Proprietary | Self-adjusting AI confidence thresholds based on feedback loops |
| Anti-Hallucination Framework | Trade Secret | Multi-layer verification system preventing AI fabrication of intelligence |
| Reliability First Protocol | Proprietary | Citation and source verification requirements for AI outputs |
| Simple Acknowledgment Detection | Proprietary | Context-aware conversational AI that recognizes simple responses |

### 2.3 Edge Function Library

The following edge functions represent significant R&D investment:

**Tier 1 - Core Trade Secrets:**
- `ai-decision-engine` - Automated threat assessment and incident creation logic
- `incident-agent-orchestrator` - Multi-agent investigation coordination
- `correlate-signals` - Signal pattern matching and grouping algorithms
- `correlate-entities` - Entity extraction and relationship inference
- `threat-radar-analysis` - Comprehensive threat landscape assessment

**Tier 2 - Proprietary Methods:**
- `auto-orchestrator` - Automated monitoring coordination
- `calculate-anticipation-index` - Predictive threat scoring
- `dashboard-ai-assistant` - Context-aware AI assistant with tool calling
- `agent-chat` - Specialized agent interaction with reliability validation

**Tier 3 - Implementation Know-How:**
- All 50+ OSINT monitoring functions
- Document processing and entity extraction
- Travel risk assessment algorithms

---

## 3. Trade Secrets

### 3.1 Algorithms & Methods

| Trade Secret | Business Value | Protection Level |
|--------------|----------------|------------------|
| Signal Severity Scoring | Enables accurate threat prioritization | Maximum |
| Entity Risk Calculation | Differentiates threat actors by danger level | Maximum |
| Incident Auto-Creation Rules | Reduces analyst workload by 70%+ | Maximum |
| OSINT Source Weighting | Improves signal quality assessment | High |
| Duplicate Detection Logic | Prevents alert fatigue | High |
| AI Agent Persona Templates | Enables specialized investigation capabilities | High |

### 3.2 Data Processing Methods

1. **Signal Normalization Pipeline**
   - Proprietary text normalization algorithms
   - Multi-source deduplication logic
   - Confidence score calculation methods

2. **Entity Extraction System**
   - Named entity recognition fine-tuning
   - Alias detection and resolution
   - Relationship inference algorithms

3. **Threat Scoring Model**
   - Multi-factor severity assessment
   - Temporal decay functions
   - Client-specific risk weighting

### 3.3 Integration Architectures

- OSINT source connection patterns
- Real-time notification orchestration
- Multi-tenant data isolation methods
- AI gateway integration patterns

---

## 4. Confidential Business Information

### 4.1 Client Intelligence

| Data Type | Handling Requirement |
|-----------|---------------------|
| Client monitoring keywords | Encrypted, tenant-isolated |
| High-value asset lists | Encrypted, need-to-know access |
| Threat profiles | Encrypted, client-specific RLS |
| Entity watchlists | Encrypted, audit-logged access |

### 4.2 Operational Data

- OSINT source configurations and API integrations
- Monitoring scan frequencies and patterns
- Alert threshold configurations
- Escalation rule definitions

### 4.3 Business Metrics

- AI accuracy rates and performance metrics
- False positive/negative rates
- Mean time to detect (MTTD) benchmarks
- Mean time to resolve (MTTR) benchmarks

---

## 5. Access Control Matrix

### 5.1 IP Access by Role

| IP Category | super_admin | admin | analyst | viewer |
|-------------|-------------|-------|---------|--------|
| Algorithm Source Code | ✅ | ❌ | ❌ | ❌ |
| Edge Function Logic | ✅ | ❌ | ❌ | ❌ |
| AI System Prompts | ✅ | ✅ | ❌ | ❌ |
| Client Configurations | ✅ | ✅ | ✅ | ❌ |
| Operational Dashboards | ✅ | ✅ | ✅ | ✅ |

### 5.2 Development Access

| Team Member | Repository Access | Production Access | Secrets Access |
|-------------|-------------------|-------------------|----------------|
| Lead Developer | Full | Full | Full |
| Backend Developer | Full | Read-only | Limited |
| Frontend Developer | Full | Read-only | None |
| Security Analyst | Docs only | Read-only | None |

---

## 6. Protection Measures

### 6.1 Technical Controls

- **Code Repository**: Private GitHub repository with branch protection
- **Secrets Management**: Supabase secrets, never in codebase
- **Database Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Row Level Security**: Tenant isolation at database level
- **Audit Logging**: All sensitive operations logged

### 6.2 Operational Controls

- Employee confidentiality agreements
- Code review requirements for sensitive areas
- Limited production access
- Regular access reviews

### 6.3 Legal Protections

- [ ] Non-disclosure agreements with all contractors
- [ ] Employment agreements with IP assignment clauses
- [ ] Terms of service protecting platform IP
- [ ] Privacy policy compliant with PIPEDA

---

## 7. IP Development Log

### Recent Innovations (2026)

| Date | Innovation | Status | Inventor |
|------|------------|--------|----------|
| Jan 18, 2026 | Simple Acknowledgment Detection | Implemented | Development Team |
| Jan 2026 | Anti-Hallucination Framework | Implemented | Development Team |
| Jan 2026 | Reliability First Protocol | Implemented | Development Team |
| 2025 | AI Agent Architecture | Production | Development Team |
| 2025 | Autonomous SOC Framework | Production | Development Team |

### Pending Patents / Registrations

- [ ] Consider patent application for Anticipation Index algorithm
- [ ] Consider trademark registration for "FORTRESS" brand
- [ ] Document all invention disclosures

---

## 8. Third-Party IP

### 8.1 Licensed Technology

| Technology | Vendor | License Type | Restrictions |
|------------|--------|--------------|--------------|
| Supabase | Supabase Inc. | Apache 2.0 | Open source |
| React | Meta | MIT | Open source |
| Tailwind CSS | Tailwind Labs | MIT | Open source |
| Lovable AI Gateway | Lovable | Commercial API | Per-workspace usage |
| Mapbox GL | Mapbox | Commercial | Attribution required |

### 8.2 Open Source Components

All open source dependencies listed in `package.json` with compatible licenses (MIT, Apache 2.0, BSD).

---

## 9. Incident Response

### IP Breach Protocol

1. **Detection**: Monitor for unauthorized access, code leaks, or competitive intelligence
2. **Containment**: Revoke access, rotate secrets, isolate affected systems
3. **Assessment**: Determine scope and impact of breach
4. **Notification**: Legal counsel, affected parties as required
5. **Remediation**: Patch vulnerabilities, enhance controls
6. **Documentation**: Complete incident report for legal records

---

## 10. Review & Updates

This document should be reviewed:
- Quarterly for accuracy
- After any significant platform changes
- After any IP-related incidents
- When new trade secrets are developed

---

**Document History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 18, 2026 | Development Team | Initial creation |

---

*This document contains confidential trade secrets and proprietary information of Ember Leaf Security Inc. Unauthorized disclosure, copying, or distribution is strictly prohibited.*
