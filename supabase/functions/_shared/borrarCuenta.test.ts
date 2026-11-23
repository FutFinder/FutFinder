// Pruebas de la limpieza de archivos de `eliminar-cuenta`. Se corren con
// `deno test` y no tocan red: el Storage es un objeto en memoria.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type Almacen,
  BUCKETS_PERSONALES,
  esCarpetaDePersona,
  limpiarCarpetas,
  listarArchivos,
  MENSAJE_INESPERADO,
  motivoParaMostrar,
} from "./borrarCuenta.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const OTRO = "99999999-2222-4333-8444-555555555555";

/** Un bucket en memoria: `archivos` son rutas completas. */
function bucket(archivos: string[], { fallaAlListar = false } = {}) {
  const vivos = new Set(archivos);
  const almacen: Almacen = {
    list(prefijo, { limit, offset }) {
      if (fallaAlListar) return Promise.resolve({ data: null, error: new Error("caído") });
      const hijos = new Map<string, { name: string; id: string | null }>();
      for (const ruta of vivos) {
        if (!ruta.startsWith(prefijo + "/")) continue;
        const resto = ruta.slice(prefijo.length + 1);
        const [primero, ...mas] = resto.split("/");
        hijos.set(primero, { name: primero, id: mas.length ? null : "archivo" });
      }
      const lista = [...hijos.values()].sort((a, b) => a.name.localeCompare(b.name));
      return Promise.resolve({ data: lista.slice(offset, offset + limit), error: null });
    },
    remove(rutas) {
      for (const r of rutas) vivos.delete(r);
      return Promise.resolve({ error: null });
    },
  };
  return { almacen, vivos };
}

Deno.test("lista archivos sueltos, subcarpetas y más de una página", async () => {
  const muchos = Array.from({ length: 130 }, (_, i) => `${UID}/foto-${String(i).padStart(3, "0")}.jpg`);
  const { almacen } = bucket([...muchos, `${UID}/sub/a.jpg`, `${OTRO}/b.jpg`]);
  const rutas = await listarArchivos(almacen, UID);
  assertEquals(rutas.length, 131);
  assertEquals(rutas.includes(`${UID}/sub/a.jpg`), true);
  assertEquals(rutas.some((r) => r.startsWith(OTRO)), false);
});

Deno.test("borra sólo la carpeta de la persona en cada bucket personal", async () => {
  const buckets = new Map(BUCKETS_PERSONALES.map((b) => [b, bucket([`${UID}/1.jpg`, `${OTRO}/2.jpg`])]));
  const r = await limpiarCarpetas((b) => buckets.get(b as typeof BUCKETS_PERSONALES[number])!.almacen, UID);
  assertEquals(r, { borrados: BUCKETS_PERSONALES.length, completo: true });
  for (const { vivos } of buckets.values()) assertEquals([...vivos], [`${OTRO}/2.jpg`]);
});

Deno.test("un bucket caído no frena a los demás, pero deja la limpieza incompleta", async () => {
  const sano = bucket([`${UID}/1.jpg`]);
  const caido = bucket([`${UID}/1.jpg`], { fallaAlListar: true });
  const r = await limpiarCarpetas((b) => (b === "avatars" ? caido.almacen : sano.almacen), UID);
  assertEquals(r.completo, false);
  assertEquals(sano.vivos.size, 0);
});

Deno.test("nunca se vacía un bucket entero: sin uuid no se borra nada", async () => {
  const { almacen, vivos } = bucket([`${UID}/1.jpg`]);
  for (const malo of ["", "/", "..", "abc", `${UID}/x`]) {
    assertEquals(esCarpetaDePersona(malo), false);
    const r = await limpiarCarpetas(() => almacen, malo);
    assertEquals(r, { borrados: 0, completo: false });
  }
  assertEquals(vivos.size, 1);
});

Deno.test("sólo los textos propios de la base llegan a la persona", () => {
  assertEquals(
    motivoParaMostrar({ code: "P0001", message: "Tienes $3.000 de saldo a favor." }),
    "Tienes $3.000 de saldo a favor.",
  );
  assertEquals(motivoParaMostrar({ code: "23503", message: "violates foreign key constraint" }), MENSAJE_INESPERADO);
  assertEquals(motivoParaMostrar(null), MENSAJE_INESPERADO);
});
