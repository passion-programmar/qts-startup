import assert from "node:assert/strict";
import test from "node:test";
import { parseEcbRates } from "./exchange-rates";

test("the ECB daily file gives rates per 1 EUR", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time='2026-10-23'>
<Cube currency='USD' rate='1.0845'/><Cube currency='PLN' rate='4.2810'/><Cube currency='GBP' rate='0.8412'/>
</Cube></Cube></gesmes:Envelope>`;
  assert.deepEqual(parseEcbRates(xml), {
    base: "EUR",
    date: "2026-10-23",
    rates: { EUR: 1, USD: 1.0845, PLN: 4.281, GBP: 0.8412 },
  });
});

test("a file without rates gives none", () => {
  assert.equal(parseEcbRates("<html>Service unavailable</html>"), null);
});
