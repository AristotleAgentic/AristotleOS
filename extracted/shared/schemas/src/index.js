export const baseArtifactSchema = {
    $id: "base-artifact",
    type: "object",
    required: ["id", "artifactType", "timestamp", "actor"],
    properties: {
        id: { type: "string" },
        artifactType: { type: "string" },
        timestamp: { type: "string", format: "date-time" },
        actor: { type: "string" },
        issuer: { type: "string" },
        signature: { type: "string" },
        traceId: { type: "string" },
        chainId: { type: "string" },
        verification: {
            type: "object",
            properties: {
                status: { enum: ["verified", "unverified", "failed"] },
                verifier: { type: "string" },
                reason: { type: "string" }
            }
        }
    }
};
export const authorityEnvelopeSchema = {
    $id: "authority-envelope",
    allOf: [baseArtifactSchema],
    required: ["domain", "subject", "action", "validFrom", "validUntil", "permittedEffects", "metaAuthorityRef"],
    properties: {
        domain: { type: "string" },
        subject: { type: "string" },
        action: { type: "string" },
        validFrom: { type: "string", format: "date-time" },
        validUntil: { type: "string", format: "date-time" },
        permittedEffects: { type: "array", items: { type: "string" } },
        constraints: { type: "object" },
        issuerChain: { type: "array", items: { type: "string" } },
        metaAuthorityRef: { type: "string" }
    }
};
export const executionWarrantSchema = {
    $id: "execution-warrant",
    allOf: [baseArtifactSchema],
    required: ["envelopeId", "admissibilityHash", "missionId", "targetNode", "obligations"],
    properties: {
        envelopeId: { type: "string" },
        admissibilityHash: { type: "string" },
        missionId: { type: "string" },
        targetNode: { type: "string" },
        obligations: {
            type: "object",
            required: ["witnessRequired"],
            properties: {
                witnessRequired: { type: "boolean" },
                minQuorum: { type: "number" }
            }
        }
    }
};
export const witnessReceiptSchema = {
    $id: "witness-receipt",
    allOf: [baseArtifactSchema],
    required: ["warrantId", "envelopeId", "quorumRequired", "quorumReached", "witnesses", "accepted"],
    properties: {
        warrantId: { type: "string" },
        envelopeId: { type: "string" },
        quorumRequired: { type: "number" },
        quorumReached: { type: "number" },
        witnesses: { type: "array", items: { type: "string" } },
        accepted: { type: "boolean" }
    }
};
export const replayEventSchema = {
    $id: "replay-event",
    allOf: [baseArtifactSchema],
    required: ["eventKind", "committed", "payload"],
    properties: {
        eventKind: { type: "string" },
        committed: { type: "boolean" },
        branchId: { type: "string" },
        payload: { type: "object" }
    }
};
