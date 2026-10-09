import { describe, expect, it } from "vitest";
import { endOfDay, parseCivilDate, startOfDay } from "../src/domain/civil-date.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const day = (s: string) => parseCivilDate(s)!;

describe("parseCivilDate", () => {
  it("aceita só YYYY-MM-DD válido", () => {
    expect(parseCivilDate("2026-03-13")).toEqual({ year: 2026, month: 3, day: 13 });
    expect(parseCivilDate("2026-02-30")).toBeNull();
    expect(parseCivilDate("2026-03-13T00:00:00Z")).toBeNull();
    expect(parseCivilDate("0001-01-01")).toBeNull();
  });
});

describe("limites do dia calculados pelas regras do fuso, não por -03:00 fixo", () => {
  it("São Paulo hoje: -03:00", () => {
    expect(iso(startOfDay(day("2026-03-13"), "America/Sao_Paulo"))).toBe("2026-03-13T03:00:00.000Z");
    expect(iso(endOfDay(day("2026-03-13"), "America/Sao_Paulo"))).toBe("2026-03-14T02:59:59.999Z");
  });

  it("virada de mês, de ano e dia bissexto", () => {
    expect(iso(endOfDay(day("2026-12-31"), "America/Sao_Paulo"))).toBe("2027-01-01T02:59:59.999Z");
    expect(iso(endOfDay(day("2028-02-29"), "America/Sao_Paulo"))).toBe("2028-03-01T02:59:59.999Z");
  });

  it("São Paulo em 2018 (horário de verão): o dia 04/11 começou à 01:00 locais, sem meia-noite", () => {
    expect(iso(startOfDay(day("2018-11-04"), "America/Sao_Paulo"))).toBe("2018-11-04T03:00:00.000Z");
    expect(iso(endOfDay(day("2018-11-04"), "America/Sao_Paulo"))).toBe("2018-11-05T01:59:59.999Z"); // -02:00
  });

  it("São Paulo em 2018: dia 17/02 tem 25 horas e termina com offset -03:00", () => {
    expect(iso(endOfDay(day("2018-02-17"), "America/Sao_Paulo"))).toBe("2018-02-18T02:59:59.999Z");
  });

  it("outro fuso com DST (Nova York): dia de 23 horas", () => {
    const start = startOfDay(day("2026-03-08"), "America/New_York");
    const end = endOfDay(day("2026-03-08"), "America/New_York");
    expect(iso(start)).toBe("2026-03-08T05:00:00.000Z");
    expect(iso(end)).toBe("2026-03-09T03:59:59.999Z");
    expect((end + 1 - start) / 3_600_000).toBe(23);
  });

  it("fuso a leste de UTC (Auckland, +13 em janeiro) e Kiritimati (+14)", () => {
    expect(iso(endOfDay(day("2026-01-15"), "Pacific/Auckland"))).toBe("2026-01-15T10:59:59.999Z");
    expect(iso(startOfDay(day("2026-01-15"), "Pacific/Kiritimati"))).toBe("2026-01-14T10:00:00.000Z");
  });
});
