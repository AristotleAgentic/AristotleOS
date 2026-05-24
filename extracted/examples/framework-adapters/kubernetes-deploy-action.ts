// Kubernetes deploy action adapter.
//
// `kubectl apply` is a consequential, often-irreversible action. Here it runs only
// on ALLOW + verified Warrant; a destructive namespace delete is denied at the gate.
// Run: npx tsx examples/framework-adapters/kubernetes-deploy-action.ts
import { governToolCall, type ToolCall } from "./govern.js";
import { k8sBinding } from "./_fixtures.js";

void (async () => {
  const apply: ToolCall = {
    name: "k8s.apply", callId: "deploy-1",
    arguments: { resource: "deployment/web", manifest: "apps/web/deployment.yaml" }
  };
  const outcome = await governToolCall(apply, k8sBinding, ({ warrant }) => ({ applied: "deployment/web", under_warrant: warrant.warrant_id }));
  if (outcome.status === "executed") {
    console.log(`ALLOW — kubectl apply ran under warrant ${outcome.warrant.warrant_id} (GEL ${outcome.record.record_id})`);
  } else {
    console.log(`${outcome.decision} — apply withheld`, "reason_codes" in outcome ? outcome.reason_codes : outcome.reason);
  }

  // A destructive action the envelope denies.
  const destroy: ToolCall = { name: "k8s.delete_namespace", callId: "destroy-1", arguments: { resource: "namespace/prod" } };
  const blocked = await governToolCall(destroy, k8sBinding, () => "should not run");
  console.log(`${blocked.decision} — namespace delete`, "reason_codes" in blocked ? blocked.reason_codes : "");
})();
