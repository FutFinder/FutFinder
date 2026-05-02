/**
 * Regiones y comunas de Chile.
 * Lista oficial de las 16 regiones administrativas (post-reforma 2017
 * con la creación de la Región del Ñuble).
 *
 * Cada región tiene:
 *  - nombre: nombre completo
 *  - codigo: número romano oficial
 *  - comunas: lista alfabética
 *
 * Las comunas y regiones están pre-ordenadas alfabéticamente
 * (locale es-CL) para que la UI las muestre tal cual.
 */

const REGIONES_RAW = [
  {
    nombre: 'Región de Antofagasta',
    codigo: 'II',
    comunas: [
      'Antofagasta', 'Calama', 'María Elena', 'Mejillones', 'Ollagüe',
      'San Pedro de Atacama', 'Sierra Gorda', 'Taltal', 'Tocopilla',
    ],
  },
  {
    nombre: 'Región de Arica y Parinacota',
    codigo: 'XV',
    comunas: ['Arica', 'Camarones', 'General Lagos', 'Putre'],
  },
  {
    nombre: 'Región de Atacama',
    codigo: 'III',
    comunas: [
      'Alto del Carmen', 'Caldera', 'Chañaral', 'Copiapó', 'Diego de Almagro',
      'Freirina', 'Huasco', 'Tierra Amarilla', 'Vallenar',
    ],
  },
  {
    nombre: 'Región de Aysén del General Carlos Ibáñez del Campo',
    codigo: 'XI',
    comunas: [
      'Aysén', 'Chile Chico', 'Cisnes', 'Cochrane', 'Coyhaique', 'Guaitecas',
      'Lago Verde', 'O’Higgins', 'Río Ibáñez', 'Tortel',
    ],
  },
  {
    nombre: 'Región del Biobío',
    codigo: 'VIII',
    comunas: [
      'Alto Biobío', 'Antuco', 'Arauco', 'Cabrero', 'Cañete', 'Chiguayante',
      'Concepción', 'Contulmo', 'Coronel', 'Curanilahue', 'Florida', 'Hualpén',
      'Hualqui', 'Laja', 'Lebu', 'Los Álamos', 'Los Ángeles', 'Lota',
      'Mulchén', 'Nacimiento', 'Negrete', 'Penco', 'Quilaco', 'Quilleco',
      'San Pedro de la Paz', 'San Rosendo', 'Santa Bárbara', 'Santa Juana',
      'Talcahuano', 'Tirúa', 'Tomé', 'Tucapel', 'Yumbel',
    ],
  },
  {
    nombre: 'Región de Coquimbo',
    codigo: 'IV',
    comunas: [
      'Andacollo', 'Canela', 'Combarbalá', 'Coquimbo', 'Illapel', 'La Higuera',
      'La Serena', 'Los Vilos', 'Monte Patria', 'Ovalle', 'Paihuano',
      'Punitaqui', 'Río Hurtado', 'Salamanca', 'Vicuña',
    ],
  },
  {
    nombre: 'Región de La Araucanía',
    codigo: 'IX',
    comunas: [
      'Angol', 'Carahue', 'Cholchol', 'Collipulli', 'Cunco', 'Curacautín',
      'Curarrehue', 'Ercilla', 'Freire', 'Galvarino', 'Gorbea', 'Lautaro',
      'Loncoche', 'Lonquimay', 'Los Sauces', 'Lumaco', 'Melipeuco',
      'Nueva Imperial', 'Padre Las Casas', 'Perquenco', 'Pitrufquén',
      'Pucón', 'Puerto Saavedra', 'Purén', 'Renaico', 'Saavedra', 'Temuco',
      'Teodoro Schmidt', 'Toltén', 'Traiguén', 'Victoria', 'Vilcún',
      'Villarrica',
    ],
  },
  {
    nombre: 'Región del Libertador General Bernardo O’Higgins',
    codigo: 'VI',
    comunas: [
      'Chépica', 'Chimbarongo', 'Codegua', 'Coínco', 'Coltauco', 'Doñihue',
      'Graneros', 'La Estrella', 'Las Cabras', 'Litueche', 'Lolol', 'Machalí',
      'Malloa', 'Marchihue', 'Mostazal', 'Nancagua', 'Navidad', 'Olivar',
      'Palmilla', 'Paredones', 'Peralillo', 'Peumo', 'Pichidegua', 'Pichilemu',
      'Placilla', 'Pumanque', 'Quinta de Tilcoco', 'Rancagua', 'Rengo',
      'Requínoa', 'San Fernando', 'San Vicente', 'Santa Cruz',
    ],
  },
  {
    nombre: 'Región de Los Lagos',
    codigo: 'X',
    comunas: [
      'Ancud', 'Calbuco', 'Castro', 'Chaitén', 'Chonchi', 'Cochamó',
      'Curaco de Vélez', 'Dalcahue', 'Fresia', 'Frutillar', 'Futaleufú',
      'Hualaihué', 'Llanquihue', 'Los Muermos', 'Maullín', 'Osorno', 'Palena',
      'Puerto Montt', 'Puerto Octay', 'Puerto Varas', 'Puqueldón', 'Purranque',
      'Puyehue', 'Queilén', 'Quellón', 'Quemchi', 'Quinchao', 'Río Negro',
      'San Juan de la Costa', 'San Pablo',
    ],
  },
  {
    nombre: 'Región de Los Ríos',
    codigo: 'XIV',
    comunas: [
      'Corral', 'Futrono', 'La Unión', 'Lago Ranco', 'Lanco', 'Los Lagos',
      'Máfil', 'Mariquina', 'Paillaco', 'Panguipulli', 'Río Bueno', 'Valdivia',
    ],
  },
  {
    nombre: 'Región de Magallanes y de la Antártica Chilena',
    codigo: 'XII',
    comunas: [
      'Antártica', 'Cabo de Hornos', 'Laguna Blanca', 'Natales', 'Porvenir',
      'Primavera', 'Punta Arenas', 'Río Verde', 'San Gregorio', 'Timaukel',
      'Torres del Paine',
    ],
  },
  {
    nombre: 'Región del Maule',
    codigo: 'VII',
    comunas: [
      'Cauquenes', 'Chanco', 'Colbún', 'Constitución', 'Curepto', 'Curicó',
      'Empedrado', 'Hualañé', 'Licantén', 'Linares', 'Longaví', 'Maule',
      'Molina', 'Parral', 'Pelarco', 'Pelluhue', 'Pencahue', 'Rauco', 'Retiro',
      'Río Claro', 'Romeral', 'Sagrada Familia', 'San Clemente', 'San Javier',
      'San Rafael', 'Talca', 'Teno', 'Vichuquén', 'Villa Alegre',
      'Yerbas Buenas',
    ],
  },
  {
    nombre: 'Región Metropolitana de Santiago',
    codigo: 'RM',
    comunas: [
      'Alhué', 'Buin', 'Calera de Tango', 'Cerrillos', 'Cerro Navia', 'Colina',
      'Conchalí', 'Curacaví', 'El Bosque', 'El Monte', 'Estación Central',
      'Huechuraba', 'Independencia', 'Isla de Maipo', 'La Cisterna',
      'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Lampa',
      'Las Condes', 'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul', 'Maipú',
      'María Pinto', 'Melipilla', 'Ñuñoa', 'Padre Hurtado', 'Paine',
      'Pedro Aguirre Cerda', 'Peñaflor', 'Peñalolén', 'Pirque', 'Providencia',
      'Pudahuel', 'Puente Alto', 'Quilicura', 'Quinta Normal', 'Recoleta',
      'Renca', 'San Bernardo', 'San Joaquín', 'San José de Maipo',
      'San Miguel', 'San Pedro', 'San Ramón', 'Santiago', 'Talagante', 'Tiltil',
      'Vitacura',
    ],
  },
  {
    nombre: 'Región del Ñuble',
    codigo: 'XVI',
    comunas: [
      'Bulnes', 'Chillán', 'Chillán Viejo', 'Cobquecura', 'Coelemu', 'Coihueco',
      'El Carmen', 'Ninhue', 'Ñiquén', 'Pemuco', 'Pinto', 'Portezuelo',
      'Quillón', 'Quirihue', 'Ránquil', 'San Carlos', 'San Fabián',
      'San Ignacio', 'San Nicolás', 'Treguaco', 'Yungay',
    ],
  },
  {
    nombre: 'Región de Tarapacá',
    codigo: 'I',
    comunas: [
      'Alto Hospicio', 'Camiña', 'Colchane', 'Huara', 'Iquique', 'Pica',
      'Pozo Almonte',
    ],
  },
  {
    nombre: 'Región de Valparaíso',
    codigo: 'V',
    comunas: [
      'Algarrobo', 'Cabildo', 'Calera', 'Calle Larga', 'Cartagena',
      'Casablanca', 'Catemu', 'Concón', 'El Quisco', 'El Tabo', 'Hijuelas',
      'Isla de Pascua', 'Juan Fernández', 'La Cruz', 'La Ligua', 'Limache',
      'Llaillay', 'Los Andes', 'Nogales', 'Olmué', 'Panquehue', 'Papudo',
      'Petorca', 'Puchuncaví', 'Putaendo', 'Quillota', 'Quilpué', 'Quintero',
      'Rinconada', 'San Antonio', 'San Esteban', 'San Felipe', 'Santa María',
      'Santo Domingo', 'Valparaíso', 'Villa Alemana', 'Viña del Mar', 'Zapallar',
    ],
  },
];

// Función auxiliar de orden alfabético respetando acentos español
const sortEs = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' });

// Pre-ordenamos todo alfabéticamente
export const REGIONES = [...REGIONES_RAW]
  .sort((a, b) => sortEs(a.nombre, b.nombre))
  .map((r) => ({
    ...r,
    comunas: [...r.comunas].sort(sortEs),
  }));

export const NOMBRES_REGIONES = REGIONES.map((r) => r.nombre);

// Devuelve las comunas de una región dado su nombre, [] si no existe
export function getComunasOfRegion(nombreRegion) {
  const r = REGIONES.find((x) => x.nombre === nombreRegion);
  return r ? r.comunas : [];
}

// Devuelve la región a la que pertenece una comuna (string nombre o null)
export function getRegionOfComuna(comuna) {
  for (const r of REGIONES) {
    if (r.comunas.includes(comuna)) return r.nombre;
  }
  return null;
}
