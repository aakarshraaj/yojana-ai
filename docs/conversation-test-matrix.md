# Conversation Test Matrix (India Tier 2/3/4)

This matrix is tuned for Indian users across tier 2/3/4 cities and towns, including Hinglish, Marathi/Hindi mixing, short-form text, and low-formality language.

## Contract
- `mode=list`: return 3-5 schemes
- `mode=focused`: single selected scheme only
- `mode=compare`: exactly 2 schemes
- `mode=clarify`: no scheme list
- `retrieval=blocked`: do not run vector retrieval
- `retrieval=allowed`: vector retrieval allowed

## Persona/Linguistic Styles

### A) Formal English
- Example: `I am a 26-year-old student from Indore. Suggest scholarship schemes.`
- Expected: direct profile extraction + list/clarify

### B) Hinglish (Roman)
- Example: `mai bihar se hu, income low hai, kaunsi yojana milegi?`
- Expected: parse state + income + request intent

### C) Hindi in Devanagari
- Example: `मैं उत्तर प्रदेश से हूं, मुझे स्वरोजगार योजना चाहिए`
- Expected: translate canonical to English internally, respond in Hindi if requested

### D) Marathi in Devanagari
- Example: `मी नाशिकचा आहे, मला व्यवसायासाठी योजना पाहिजे`
- Expected: canonicalize, preserve session/mode in Marathi flow

### E) Mixed scripts
- Example: `Mai OBC hu aur income 1 lakh, scholarship चाहिए`
- Expected: robust extraction from mixed script utterance

### F) Local shorthand / low punctuation
- Example: `mp se hu student no income`
- Expected: still extract profile fields and ask only next missing field

### G) Low-signal chatter
- Example: `lol`, `acha`, `hmm`, `let's go`
- Expected: clarify only, retrieval blocked

### H) Garbled / nonsense
- Example: `ksjdfhksjdfh`, `.....`, `🔥🔥🔥`
- Expected: "could not understand" guidance, retrieval blocked

## Interaction Modes

### 1) New discovery request
- Style: full/partial profile + scheme ask
- Expected: `intent=new_discovery`, `mode=list|clarify`, retrieval allowed if signal sufficient

### 2) Complaint correction
- Style: `I asked Arunachal, why Rajasthan?`
- Expected: acknowledge error, clear focused scheme, strict state rerank, corrected list

### 3) Detail request on selected scheme
- Style: `documents de`, `office address`, `apply link`
- Expected: `mode=focused`, no list of alternatives

### 4) Detail request without scheme reference
- Style: `more details do`
- Expected: ask which scheme from shortlist (`mode=clarify`)

### 5) Compare request
- Style: `A aur B compare karo`, `which better`
- Expected: exactly two schemes in compare output

### 6) Selection request
- Style: `first wala`, `yeh wala select`
- Expected: lock selected scheme and continue focused mode

### 7) Clarification answers
- Style: short profile answers (`Jharkhand`, `OBC`, `income 0`)
- Expected: update memory and ask next missing field

## Tier 2/3/4 Context Cases

### Education / exam support
- `UPSC CSE mains ke liye scheme hai kya`
- `NEET coaching ke liye koi scholarship`
- `ITI student hu madad chahiye`

### Livelihood / micro business
- `meri medical shop hai loan yojana batao`
- `silai machine ke liye mahila yojana`
- `chhota kirana dukaan hai subsidy milegi?`

### Agriculture / rural
- `2 acre zameen hai kisan hu`
- `pm kisan ke alawa aur kya`
- `drip irrigation ke liye support`

### Welfare / identity-linked
- `BPL hu`, `ration card hai`, `widow pension`
- `SC category hu scholarship`
- `divyang certificate hai koi yojana`

## High-Risk Edge Cases
1. User gives only profession -> ask state next.
2. User gives only income (`no income`) -> capture `0`, ask next field.
3. User gives age in Hindi/Marathi (`25 saal`, `25 वर्ष`) -> capture age.
4. User switches language mid-session -> preserve memory + mode.
5. User detail request after complaint -> do not jump unrelated.
6. User says `yes`/`ok` after question -> ask pending question explicitly.
7. User asks out-of-scope (`weather`, `movie`) -> scope redirect.
8. User asks harmful/illegal guidance -> refuse and redirect.

## Regression Acceptance Rules
- No list output for noise/nonsense/unclear ack.
- Complaint response must acknowledge correction.
- Focused mode must never output a fresh recommendation list.
- Compare mode must show exactly two schemes.
- State guardrail must filter mismatched state schemes.
- Session continuity must persist profile + selectedScheme.
- Hindi/Marathi requests must preserve intent/mode behavior.
