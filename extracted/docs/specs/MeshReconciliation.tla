------------------------ MODULE MeshReconciliation ------------------------
EXTENDS Naturals, Sequences, FiniteSets

\* One implicit envelope, honest root/edges, authenticated messages, logical
\* time, bounded histories. Root gossip reaches connected edges immediately;
\* partitions may hide revocation until a successful pull. No cryptographic,
\* physical, database, byzantine, or implementation-refinement claim is made.
CONSTANTS Edges, MaxTime, MaxWarrants, MaxDisconnectedWarrants, TokenTTL
VARIABLES clock, revokedAt, known, partitioned, warrants, quota, expires,
          reconciledCount, reconciledRevocation, conflicts

vars == <<clock, revokedAt, known, partitioned, warrants, quota, expires,
          reconciledCount, reconciledRevocation, conflicts>>
NoRevocation == MaxTime + 1

Init ==
  /\ clock = 0
  /\ revokedAt = NoRevocation
  /\ known = [e \in Edges |-> FALSE]
  /\ partitioned = [e \in Edges |-> FALSE]
  /\ warrants = [e \in Edges |-> <<>>]
  /\ quota = [e \in Edges |-> 0]
  /\ expires = [e \in Edges |-> TokenTTL]
  /\ reconciledCount = [e \in Edges |-> 0]
  /\ reconciledRevocation = [e \in Edges |-> NoRevocation]
  /\ conflicts = [e \in Edges |-> {}]

Tick ==
  /\ clock < MaxTime
  /\ clock' = clock + 1
  /\ UNCHANGED <<revokedAt, known, partitioned, warrants, quota, expires,
                  reconciledCount, reconciledRevocation, conflicts>>

Revoke ==
  /\ revokedAt = NoRevocation
  /\ revokedAt' = clock
  /\ known' = [e \in Edges |-> known[e] \/ ~partitioned[e]]
  /\ UNCHANGED <<clock, partitioned, warrants, quota, expires,
                  reconciledCount, reconciledRevocation, conflicts>>

Partition(e) ==
  /\ ~partitioned[e]
  /\ partitioned' = [partitioned EXCEPT ![e] = TRUE]
  /\ UNCHANGED <<clock, revokedAt, known, warrants, quota, expires,
                  reconciledCount, reconciledRevocation, conflicts>>

Heal(e) ==
  /\ partitioned[e]
  /\ partitioned' = [partitioned EXCEPT ![e] = FALSE]
  /\ UNCHANGED <<clock, revokedAt, known, warrants, quota, expires,
                  reconciledCount, reconciledRevocation, conflicts>>

Pull(e) ==
  /\ ~partitioned[e]
  /\ known' = [known EXCEPT ![e] = @ \/ (revokedAt # NoRevocation)]
  /\ quota' = [quota EXCEPT ![e] = 0]
  /\ UNCHANGED <<clock, revokedAt, partitioned, warrants, expires,
                  reconciledCount, reconciledRevocation, conflicts>>

\* Renewing bounded offline authority is a root action while connected. A
\* partition never renews it, and revocation never permits renewal.
RenewToken(e) ==
  /\ ~partitioned[e]
  /\ revokedAt = NoRevocation
  /\ expires' = [expires EXCEPT ![e] = clock + TokenTTL]
  /\ UNCHANGED <<clock, revokedAt, known, partitioned, warrants, quota,
                  reconciledCount, reconciledRevocation, conflicts>>

Issue(e) ==
  /\ ~known[e]
  /\ Len(warrants[e]) < MaxWarrants \* exploration bound, not production policy
  /\ ~partitioned[e] \/ (quota[e] < MaxDisconnectedWarrants /\ clock < expires[e])
  /\ warrants' = [warrants EXCEPT ![e] = Append(@,
       [at |-> clock, knew |-> known[e], offline |-> partitioned[e],
        used |-> quota[e], expiry |-> expires[e]])]
  /\ quota' = [quota EXCEPT ![e] = IF partitioned[e] THEN @ + 1 ELSE @]
  /\ UNCHANGED <<clock, revokedAt, known, partitioned, expires,
                  reconciledCount, reconciledRevocation, conflicts>>

Reconcile(e) ==
  /\ ~partitioned[e]
  /\ reconciledCount' = [reconciledCount EXCEPT ![e] = Len(warrants[e])]
  /\ reconciledRevocation' = [reconciledRevocation EXCEPT ![e] = revokedAt]
  /\ conflicts' = [conflicts EXCEPT ![e] =
       {i \in 1..Len(warrants[e]) : revokedAt # NoRevocation /\ warrants[e][i].at >= revokedAt}]
  /\ UNCHANGED <<clock, revokedAt, known, partitioned, warrants, quota, expires>>

Next == Tick \/ Revoke \/ (\E e \in Edges :
  Partition(e) \/ Heal(e) \/ Pull(e) \/ RenewToken(e) \/ Issue(e) \/ Reconcile(e))

Spec == Init /\ [][Next]_vars /\ (\A e \in Edges : WF_vars(Pull(e)))

TypeOK ==
  /\ clock \in 0..MaxTime
  /\ revokedAt \in 0..NoRevocation
  /\ known \in [Edges -> BOOLEAN]
  /\ partitioned \in [Edges -> BOOLEAN]
  /\ quota \in [Edges -> 0..MaxDisconnectedWarrants]
  /\ \A e \in Edges : Len(warrants[e]) <= MaxWarrants

Inv_NoWarrantAfterKnownRevocation ==
  \A e \in Edges : \A i \in 1..Len(warrants[e]) : ~warrants[e][i].knew
Inv_QuotaCap == \A e \in Edges : quota[e] <= MaxDisconnectedWarrants
Inv_DisconnectedBounded ==
  \A e \in Edges : \A i \in 1..Len(warrants[e]) :
    warrants[e][i].offline =>
      (warrants[e][i].used < MaxDisconnectedWarrants /\ warrants[e][i].at < warrants[e][i].expiry)
\* Compare against the snapshot actually reconciled, never future/unseen state.
Inv_ReconcileDetectsConflict ==
  \A e \in Edges : conflicts[e] =
    {i \in 1..reconciledCount[e] : reconciledRevocation[e] # NoRevocation /\ warrants[e][i].at >= reconciledRevocation[e]}
RevocationsMonotone == [] [\A e \in Edges : known[e] => known'[e]]_known
Live_EventualConsistencyOnHeal ==
  \A e \in Edges : (<>[](~partitioned[e])) =>
    ((revokedAt # NoRevocation) ~> known[e])
=============================================================================
