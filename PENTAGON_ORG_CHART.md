# Pentagon active_graph org chart

This is the intended information flow for the Pentagon workspace.

```mermaid
flowchart LR
  subgraph L0["Intelligence layer / source of truth"]
    EVIDENCE["Repo artifacts: commits, tests, logs, status, eval, review, contract"]
  end

  subgraph DRI["DRI / outcome owners"]
    AVERY["Avery (Frame Architect)"]
    PRIYA["Priya (Goal Reaper)"]
    BLAKE["Blake (Budget Marshal)"]
  end

  subgraph SPEC["Spec and ambiguity control"]
    SOFIA["Sofia (Spec Owner)"]
    SASHA["Sasha (Spec Skeptic)"]
  end

  subgraph BUILD["Build path"]
    THEO["Theo (Test Owner)"]
    MAYA["Maya (Code Owner)"]
  end

  subgraph CONTRACT_DOCS["Contract and docs"]
    CARMEN["Carmen (Contract Owner)"]
    SAM["Sam (Docs Owner)"]
  end

  subgraph VERIFY["Review and adversarial verification"]
    ROWAN["Rowan (Code Reviewer)"]
    QUINN["Quinn (Test Adversary)"]
    RAVI["Ravi (Replay Validator)"]
  end

  subgraph GATES["Gates and forensics"]
    GRACE["Grace (Gate Sentinel)"]
    FINN["Finn (Fork Debugger)"]
    TAYLOR["Taylor (Trace Archivist)"]
  end

  subgraph PROD["Production readiness"]
    RILEY["Riley (Evidence Lead)"]
    CASEY["Casey (Compatibility Auditor)"]
    PARKER["Parker (Performance Sentinel)"]
    SIMONE["Simone (Security Auditor)"]
  end

  AVERY --> SOFIA
  AVERY --> PRIYA
  AVERY --> BLAKE

  SOFIA --> SASHA
  SOFIA --> THEO
  SASHA --> SOFIA

  THEO --> MAYA
  MAYA --> CARMEN
  MAYA --> SAM
  MAYA --> ROWAN
  MAYA --> QUINN

  CARMEN --> ROWAN
  SAM --> ROWAN

  ROWAN --> PRIYA
  QUINN --> FINN
  RAVI --> PRIYA
  GRACE --> FINN
  FINN --> MAYA
  TAYLOR --> EVIDENCE

  CASEY --> PRIYA
  PARKER --> PRIYA
  SIMONE --> PRIYA
  RILEY --> PRIYA
  RILEY --> EVIDENCE

  EVIDENCE -. "literal proof only" .-> PRIYA
  EVIDENCE -. "literal proof only" .-> ROWAN
  EVIDENCE -. "literal proof only" .-> GRACE
```

## How the Pentagon canvas should look

Arrange the canvas as a left-to-right org chart:

1. Outcome owners: Avery, Priya, Blake
2. Spec control: Sofia over Sasha
3. Build path: Theo over Maya
4. Contract/docs: Carmen over Sam
5. Verification: Rowan, Quinn, Ravi
6. Gates/forensics: Grace, Finn, Taylor
7. Production/evidence: Riley, Casey, Parker, Simone

Status cards are not the org chart. They are temporary work notices and should
be ignored when reading responsibility. The org chart is the named agent nodes
and the flow above.
