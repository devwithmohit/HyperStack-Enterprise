# Load Tests — HyperStack Enterprise

Stress and race-condition tests powered by **[k6](https://k6.io/)**.

## Prerequisites

Install k6 (no Node.js required — k6 is a standalone Go binary):

```bash
# macOS
brew install k6

# Windows (Chocolatey)
choco install k6

# Windows (winget)
winget install k6 --source winget

# Ubuntu / Debian
sudo gpg -k
sudo gpg --no-default-keyring \
     --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 \
     --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
     | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# Docker (no install needed)
docker run --rm -i grafana/k6 run - < load-tests/stress-test.js
```

---

## Start the stack before testing

```bash
# 1. Infrastructure
docker compose up -d

# 2. API server
npm run dev
# Server will be available at http://localhost:3000
```

---

## Running tests

### Default — Booking Storm (race-condition / lock stress)

Ramps 10 → 500 VUs all hitting the **same `resourceId`** simultaneously.
Validates that the Redis distributed lock prevents duplicate `CONFIRMED` bookings.

```bash
k6 run load-tests/stress-test.js
```

### Mixed Traffic (realistic read/write)

70 % list, 20 % create (unique resources), 10 % get — sustained 200 VUs.

```bash
k6 run -e SCENARIO=mixed-traffic load-tests/stress-test.js
```

### Spike (flash-sale simulation)

0 → 500 VUs in 5 seconds, held for 30 s, then dropped.

```bash
k6 run -e SCENARIO=spike load-tests/stress-test.js
```

### Target a different environment

```bash
k6 run -e BASE_URL=https://api.staging.example.com load-tests/stress-test.js
```

---

## Thresholds (CI pass/fail criteria)

| Metric | Threshold | Why |
|---|---|---|
| `http_req_duration p(95)` | < 500 ms | Overall latency budget |
| `booking_create_duration p(95)` | < 800 ms | Includes lock acquire + DB write |
| `http_req_failed rate` | < 1 % | 409/503 excluded — only true 5xx |
| `lock_contention_rate` | < 30 % | 503s (lock timeout) under storm |
| `race_condition_violations` | == 0 % | Zero duplicate CONFIRMED bookings |

> **Note:** 409 Conflict (resource already booked) and 503 Service Unavailable
> (lock timeout) are **expected and not counted as failures** during the
> booking-storm scenario. Only genuine unhandled 5xx errors fail the run.

---

## Expected booking-storm behaviour

```
VUs competing for seat:flash-sale:A1
│
├─ 1 VU  → acquires Redis lock → writes CONFIRMED booking → 201 Created
├─ N VUs → lock busy, polling → lock released → see CONFIRMED → 409 Conflict
└─ M VUs → lock timeout (3 s) → 503 Service Unavailable (retry later)
```

The `race_condition_violations` counter must remain **0** across all runs.
Any non-zero value indicates the distributed lock has a bug.

---

## Output files

A JSON summary is written to `load-tests/results/latest.json` after every run.

```bash
# Pretty-print last result
cat load-tests/results/latest.json | jq .
```

---

## CI integration (GitHub Actions example)

```yaml
- name: Run k6 load test (smoke)
  uses: grafana/k6-action@v0.3.0
  with:
    filename: load-tests/stress-test.js
  env:
    BASE_URL: http://localhost:3000
    SCENARIO: booking-storm
```
