export declare const baseArtifactSchema: {
    readonly $id: "base-artifact";
    readonly type: "object";
    readonly required: readonly ["id", "artifactType", "timestamp", "actor"];
    readonly properties: {
        readonly id: {
            readonly type: "string";
        };
        readonly artifactType: {
            readonly type: "string";
        };
        readonly timestamp: {
            readonly type: "string";
            readonly format: "date-time";
        };
        readonly actor: {
            readonly type: "string";
        };
        readonly issuer: {
            readonly type: "string";
        };
        readonly signature: {
            readonly type: "string";
        };
        readonly traceId: {
            readonly type: "string";
        };
        readonly chainId: {
            readonly type: "string";
        };
        readonly verification: {
            readonly type: "object";
            readonly properties: {
                readonly status: {
                    readonly enum: readonly ["verified", "unverified", "failed"];
                };
                readonly verifier: {
                    readonly type: "string";
                };
                readonly reason: {
                    readonly type: "string";
                };
            };
        };
    };
};
export declare const authorityEnvelopeSchema: {
    readonly $id: "authority-envelope";
    readonly allOf: readonly [{
        readonly $id: "base-artifact";
        readonly type: "object";
        readonly required: readonly ["id", "artifactType", "timestamp", "actor"];
        readonly properties: {
            readonly id: {
                readonly type: "string";
            };
            readonly artifactType: {
                readonly type: "string";
            };
            readonly timestamp: {
                readonly type: "string";
                readonly format: "date-time";
            };
            readonly actor: {
                readonly type: "string";
            };
            readonly issuer: {
                readonly type: "string";
            };
            readonly signature: {
                readonly type: "string";
            };
            readonly traceId: {
                readonly type: "string";
            };
            readonly chainId: {
                readonly type: "string";
            };
            readonly verification: {
                readonly type: "object";
                readonly properties: {
                    readonly status: {
                        readonly enum: readonly ["verified", "unverified", "failed"];
                    };
                    readonly verifier: {
                        readonly type: "string";
                    };
                    readonly reason: {
                        readonly type: "string";
                    };
                };
            };
        };
    }];
    readonly required: readonly ["domain", "subject", "action", "validFrom", "validUntil", "permittedEffects", "metaAuthorityRef"];
    readonly properties: {
        readonly domain: {
            readonly type: "string";
        };
        readonly subject: {
            readonly type: "string";
        };
        readonly action: {
            readonly type: "string";
        };
        readonly validFrom: {
            readonly type: "string";
            readonly format: "date-time";
        };
        readonly validUntil: {
            readonly type: "string";
            readonly format: "date-time";
        };
        readonly permittedEffects: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
        readonly constraints: {
            readonly type: "object";
        };
        readonly issuerChain: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
        readonly metaAuthorityRef: {
            readonly type: "string";
        };
    };
};
export declare const executionWarrantSchema: {
    readonly $id: "execution-warrant";
    readonly allOf: readonly [{
        readonly $id: "base-artifact";
        readonly type: "object";
        readonly required: readonly ["id", "artifactType", "timestamp", "actor"];
        readonly properties: {
            readonly id: {
                readonly type: "string";
            };
            readonly artifactType: {
                readonly type: "string";
            };
            readonly timestamp: {
                readonly type: "string";
                readonly format: "date-time";
            };
            readonly actor: {
                readonly type: "string";
            };
            readonly issuer: {
                readonly type: "string";
            };
            readonly signature: {
                readonly type: "string";
            };
            readonly traceId: {
                readonly type: "string";
            };
            readonly chainId: {
                readonly type: "string";
            };
            readonly verification: {
                readonly type: "object";
                readonly properties: {
                    readonly status: {
                        readonly enum: readonly ["verified", "unverified", "failed"];
                    };
                    readonly verifier: {
                        readonly type: "string";
                    };
                    readonly reason: {
                        readonly type: "string";
                    };
                };
            };
        };
    }];
    readonly required: readonly ["envelopeId", "admissibilityHash", "missionId", "targetNode", "obligations"];
    readonly properties: {
        readonly envelopeId: {
            readonly type: "string";
        };
        readonly admissibilityHash: {
            readonly type: "string";
        };
        readonly missionId: {
            readonly type: "string";
        };
        readonly targetNode: {
            readonly type: "string";
        };
        readonly obligations: {
            readonly type: "object";
            readonly required: readonly ["witnessRequired"];
            readonly properties: {
                readonly witnessRequired: {
                    readonly type: "boolean";
                };
                readonly minQuorum: {
                    readonly type: "number";
                };
            };
        };
    };
};
export declare const witnessReceiptSchema: {
    readonly $id: "witness-receipt";
    readonly allOf: readonly [{
        readonly $id: "base-artifact";
        readonly type: "object";
        readonly required: readonly ["id", "artifactType", "timestamp", "actor"];
        readonly properties: {
            readonly id: {
                readonly type: "string";
            };
            readonly artifactType: {
                readonly type: "string";
            };
            readonly timestamp: {
                readonly type: "string";
                readonly format: "date-time";
            };
            readonly actor: {
                readonly type: "string";
            };
            readonly issuer: {
                readonly type: "string";
            };
            readonly signature: {
                readonly type: "string";
            };
            readonly traceId: {
                readonly type: "string";
            };
            readonly chainId: {
                readonly type: "string";
            };
            readonly verification: {
                readonly type: "object";
                readonly properties: {
                    readonly status: {
                        readonly enum: readonly ["verified", "unverified", "failed"];
                    };
                    readonly verifier: {
                        readonly type: "string";
                    };
                    readonly reason: {
                        readonly type: "string";
                    };
                };
            };
        };
    }];
    readonly required: readonly ["warrantId", "envelopeId", "quorumRequired", "quorumReached", "witnesses", "accepted"];
    readonly properties: {
        readonly warrantId: {
            readonly type: "string";
        };
        readonly envelopeId: {
            readonly type: "string";
        };
        readonly quorumRequired: {
            readonly type: "number";
        };
        readonly quorumReached: {
            readonly type: "number";
        };
        readonly witnesses: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
        readonly accepted: {
            readonly type: "boolean";
        };
    };
};
export declare const replayEventSchema: {
    readonly $id: "replay-event";
    readonly allOf: readonly [{
        readonly $id: "base-artifact";
        readonly type: "object";
        readonly required: readonly ["id", "artifactType", "timestamp", "actor"];
        readonly properties: {
            readonly id: {
                readonly type: "string";
            };
            readonly artifactType: {
                readonly type: "string";
            };
            readonly timestamp: {
                readonly type: "string";
                readonly format: "date-time";
            };
            readonly actor: {
                readonly type: "string";
            };
            readonly issuer: {
                readonly type: "string";
            };
            readonly signature: {
                readonly type: "string";
            };
            readonly traceId: {
                readonly type: "string";
            };
            readonly chainId: {
                readonly type: "string";
            };
            readonly verification: {
                readonly type: "object";
                readonly properties: {
                    readonly status: {
                        readonly enum: readonly ["verified", "unverified", "failed"];
                    };
                    readonly verifier: {
                        readonly type: "string";
                    };
                    readonly reason: {
                        readonly type: "string";
                    };
                };
            };
        };
    }];
    readonly required: readonly ["eventKind", "committed", "payload"];
    readonly properties: {
        readonly eventKind: {
            readonly type: "string";
        };
        readonly committed: {
            readonly type: "boolean";
        };
        readonly branchId: {
            readonly type: "string";
        };
        readonly payload: {
            readonly type: "object";
        };
    };
};
