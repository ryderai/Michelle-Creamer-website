# Michelle Creamer IDX — go-live steps

Everything is written. When the `AISCidx` password lands, this is the whole job.
Roughly 30 minutes, mostly waiting on deploys.

---

## Step 1 — Test the credential before touching the site (2 min)

Paste into Terminal. Replace `YOUR_PASSWORD`.

```bash
curl -s -X POST \
  "https://galmls.paragonrels.com/OData/GALMLS/identity/connect/token" \
  -u "AISCidx:YOUR_PASSWORD" \
  -d "grant_type=client_credentials&scope=OData"
```

- **You get a long `access_token`** → good, keep going.
- **You get 401** → the credential pair is wrong. Stop. Email
  `MLS-IMTBKIVendorSupport@ice.com` and ask for the OData client_id/client_secret
  specifically. Do not spend time debugging this — it is theirs to fix.

---

## Step 2 — Copy the files in (2 min)

Into `Documents/AI-Syndicate/Michelle-Creamer/`:

- `api/listings.js` → new folder `api/`, new file
- `vercel.json` → repo root, new file
- Apply the three edits in `listings-js-patch.md` to `js/listings.js`

---

## Step 3 — Add the secrets in Vercel (3 min)

Vercel → the Michelle-Creamer project → **Settings** → **Environment Variables**.
Add two, for **all** environments:

| Name | Value |
|---|---|
| `MLS_CLIENT_ID` | `AISCidx` |
| `MLS_CLIENT_SECRET` | the password |

Do not put these in any file. Do not commit them.

---

## Step 4 — Push and check (5 min)

Push from Cursor. When the deploy finishes, open:

```
https://<the-vercel-url>/api/listings?debug=1
```

You'll get a small JSON summary — how many listings came back, how many have
photos, and a `sampleAgentIds` list. **No listing data, so it's safe to paste
here.** Send me what it says.

---

## Step 5 — Find Michelle's agent ID (2 min)

The `sampleAgentIds` field in that debug output is a list of GALMLS agent IDs.
One of them is Michelle's. To confirm which:

```
https://<the-vercel-url>/api/listings?scope=all
```

Search that output for `Creamer`, look at the `listAgentMlsId` next to it.

Then add a third environment variable in Vercel:

| Name | Value |
|---|---|
| `MLS_AGENT_MLS_ID` | Michelle's ID |

Redeploy. Now `/api/listings` returns just her listings (what the homepage cards
and featured grids want), and `/api/listings?scope=all` returns the whole market
(what property-search wants).

---

## Step 6 — Kill the fake data (10 min)

Straight from your own handoff notes. All of this has to be gone before real
listings appear beside it:

- [ ] 10 sold listings with stock photos and `PLACEHOLDER-` MLS numbers
- [ ] Invented open house dates (Jul 26 / Aug 2) — the feed supplies real ones now
- [ ] 2 fabricated commercial listings + the Bray townhome sample
- [ ] Hardcoded community card listing counts (they'll drift against live data)
- [ ] `MICHELLE_EMAIL` in `js/main.js` is blank — leads are logging to console
      instead of reaching her. Get her address from CJ.

Once the feed is confirmed working, `data/listings.json` can be deleted entirely.
It only exists as the offline fallback.

---

## Step 7 — Compliance (5 min)

- [ ] Attribution fix applied (Edit 3 in the patch file) — verify by loading
      `?scope=all` data and confirming other brokers' names show, not Michelle's
- [ ] `.idx-disclaimer` block added to the footer
- [ ] Cron confirmed in Vercel → Settings → Cron Jobs (every 6h; the NAR floor is 12h)
- [ ] **Read GALMLS's own IDX agreement.** 12 hours is the national minimum; their
      contract can be stricter and it's the one we signed.

---

## Step 8 — The recurring chore

1st of every month, email `support@greateralmls.com` with each active account —
member name and website address. Right now that's one line:

> Michelle Creamer — michellesellslibertypark.com

Set the phone reminder now.

---

## Notes on the design, if anyone asks

- **Why a server function instead of fetching from the browser?** The OAuth
  credential is a confidential client secret. In front-end JS it's public. That
  would expose AI Syndicate's MLS access, not just Michelle's site.
- **Token handling.** Paragon has no auto-refresh and publishes no fixed lifetime,
  so the function reads `expires_in` and retires the token 60s early, plus retries
  once on a 401.
- **`$expand=Media`.** Not part of RESO Web API Core certification, so it may not
  be supported. The function tries it and falls back to no-media rather than
  failing the whole request.
- **DD1.7 vs Paragon native.** Using DD1.7 (standard RESO field names) so this same
  function works for the next agent on a different MLS with only a URL change.
  Worth asking GALMLS whether DD 2.0 is available — some Paragon MLSs are already
  retiring 1.7.
