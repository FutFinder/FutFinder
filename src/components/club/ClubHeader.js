import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import {
  ArrowLeft,
  Pencil,
  Share2,
  Users,
  MapPin,
  MessageCircle,
  CalendarDays,
  Bell,
  Flag,
  ArrowLeftRight,
  ChevronDown,
} from 'lucide-react-native';

import { paleta as C, fuentes as F, alfa } from '../../theme/colors';
import { temaClub } from '../../theme/clubThemes';
import { modalidadInline } from '../../utils/clubModalidad';
import BannerBackdrop from '../ds/BannerBackdrop';
import ClubLogo from './ClubLogo';
import NivelChip from './NivelChip';
import VerifiedBadge from './VerifiedBadge';

/**
 * Cabecera de la ficha del club (rediseño de Clubes, 2026-11-26).
 *
 * De arriba abajo: la foto del club a todo el ancho con volver (o «Mis
 * clubes») a la izquierda y compartir/editar a la derecha; en las esquinas
 * de abajo, integrantes y el récord V·E·D; el logo centrado montado sobre el
 * borde; el nombre con la insignia de verificado; comuna y modalidad; y una
 * fila con el chat del club (punto rojo si hay sin leer) y el nivel.
 *
 * EL COLOR DEL CLUB ES SOLO UN ACENTO: el aro del logo y el filete bajo la
 * foto. Fondo, superficies y botones son los neutros de la app, y el banner
 * sin foto es el respaldo gris: el tema no lo tiñe. El récord usa siempre los
 * colores de victoria, empate y derrota.
 *
 * No carga nada: la pantalla le pasa lo que ya tiene. Cada acción es
 * opcional y el botón que no recibe su `on…` no se dibuja, así que quién ve
 * qué lo decide la pantalla con sus permisos, no este componente.
 */
export default function ClubHeader({
  club,
  tema = temaClub(),
  totalMiembros,
  record,
  // Arriba a la izquierda: volver, o el selector «Mis clubes» en la portada.
  onBack,
  misClubes,
  onMisClubes,
  // Arriba a la derecha.
  onShare,
  onEdit,
  // Junto al logo (sólo en la portada).
  onCalendario,
  onAvisos,
  avisosCount = 0,
  // Fila bajo el nombre.
  onChat,
  chatSinLeer = false,
  onReport,
  onMiembros,
}) {
  const modalidad = modalidadInline(club?.modalidad);
  const lugar = [club?.comuna, modalidad].filter(Boolean);

  return (
    <View>
      <View style={[styles.banner, { borderBottomColor: tema.main }]}>
        {club?.banner_url ? (
          <Image source={{ uri: club.banner_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <BannerBackdrop variant="empty" />
        )}

        <View style={styles.filaSuperior}>
          {onMisClubes ? (
            <Pressable
              onPress={onMisClubes}
              accessibilityRole="button"
              accessibilityLabel="Cambiar de club"
              style={({ pressed }) => [styles.pildora, pressed && styles.presionado]}
            >
              <ArrowLeftRight color={C.textPrimary} size={15} strokeWidth={2.2} />
              <Text style={styles.pildoraTexto}>Mis clubes</Text>
              {misClubes > 1 ? (
                <View style={styles.pildoraCuenta}>
                  <Text style={styles.pildoraCuentaTexto}>{misClubes}</Text>
                </View>
              ) : null}
              <ChevronDown color={C.textSecondary} size={15} strokeWidth={2.2} />
            </Pressable>
          ) : onBack ? (
            <BotonRedondo onPress={onBack} etiqueta="Volver" Icono={ArrowLeft} />
          ) : (
            <View />
          )}

          <View style={styles.acciones}>
            {onEdit ? <BotonRedondo onPress={onEdit} etiqueta="Editar club" Icono={Pencil} /> : null}
            {onShare ? <BotonRedondo onPress={onShare} etiqueta="Compartir club" Icono={Share2} /> : null}
          </View>
        </View>

        <View style={styles.filaInferior}>
          <Pressable
            onPress={onMiembros}
            disabled={!onMiembros}
            accessibilityRole={onMiembros ? 'button' : undefined}
            accessibilityLabel={`${totalMiembros ?? 0} integrantes`}
            style={({ pressed }) => [styles.chipFoto, pressed && styles.presionado]}
          >
            <Users color={C.textPrimary} size={14} strokeWidth={2.2} />
            <Text style={styles.chipFotoNumero}>{totalMiembros ?? 0}</Text>
            <Text style={styles.chipFotoTexto}>integrantes</Text>
          </Pressable>

          {record ? (
            <View
              style={styles.chipFoto}
              accessibilityLabel={`${record.v} victorias, ${record.e} empates, ${record.d} derrotas`}
            >
              <Text style={[styles.recordNumero, { color: C.win }]}>{record.v}</Text>
              <Text style={styles.recordLetra}>V</Text>
              <Text style={[styles.recordNumero, styles.recordSeparado]}>{record.e}</Text>
              <Text style={styles.recordLetra}>E</Text>
              <Text style={[styles.recordNumero, styles.recordSeparado, { color: C.loss }]}>{record.d}</Text>
              <Text style={styles.recordLetra}>D</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.filaLogo}>
        <View style={styles.lado}>
          {onCalendario ? (
            <BotonRedondo onPress={onCalendario} etiqueta="Calendario de partidos" Icono={CalendarDays} solido />
          ) : null}
        </View>

        <View style={styles.logoMarco}>
          <View style={[styles.logoAro, { borderColor: tema.main }]}>
            <ClubLogo uri={club?.foto_url} size={72} borderRadius={36} tema={tema} />
          </View>
        </View>

        <View style={[styles.lado, styles.ladoDerecho]}>
          {onAvisos ? (
            <View>
              <BotonRedondo
                onPress={onAvisos}
                etiqueta={avisosCount > 0 ? `Avisos del club, ${avisosCount} pendientes` : 'Avisos del club'}
                Icono={Bell}
                solido
              />
              {avisosCount > 0 ? (
                <View style={styles.insignia} pointerEvents="none">
                  <Text style={styles.insigniaTexto}>{avisosCount > 9 ? '9+' : avisosCount}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.identidad}>
        <View style={styles.nombreFila}>
          <Text style={styles.nombre} numberOfLines={2}>
            {club?.nombre}
          </Text>
          {club?.verificado ? <VerifiedBadge size={18} tema={tema} /> : null}
        </View>
        {lugar.length > 0 ? (
          <View style={styles.lugarFila}>
            <MapPin color={C.textSecondary} size={13} strokeWidth={2} />
            <Text style={styles.lugar} numberOfLines={1}>
              {lugar.join(' · ')}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.filaChips}>
        {onChat ? (
          <Pressable
            onPress={onChat}
            accessibilityRole="button"
            accessibilityLabel={chatSinLeer ? 'Chat del club, hay mensajes sin leer' : 'Chat del club'}
            style={({ pressed }) => [styles.chipAccion, pressed && styles.presionado]}
          >
            <View>
              <MessageCircle color={C.textPrimary} size={15} strokeWidth={2.2} />
              {chatSinLeer ? <View style={styles.puntoRojo} /> : null}
            </View>
            <Text style={styles.chipAccionTexto}>Chat del club</Text>
          </Pressable>
        ) : onReport ? (
          <Pressable
            onPress={onReport}
            accessibilityRole="button"
            accessibilityLabel="Reportar club"
            style={({ pressed }) => [styles.chipAccion, pressed && styles.presionado]}
          >
            <Flag color={C.textSecondary} size={14} strokeWidth={2.2} />
            <Text style={[styles.chipAccionTexto, { color: C.textSecondary }]}>Reportar club</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <NivelChip nivel={club?.nivel} />
      </View>
    </View>
  );
}

function BotonRedondo({ onPress, etiqueta, Icono, solido = false }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        styles.botonRedondo,
        solido && styles.botonRedondoSolido,
        pressed && styles.presionado,
      ]}
    >
      <Icono color={C.textPrimary} size={17} strokeWidth={2.2} />
    </Pressable>
  );
}

const ALTO_BANNER = 196;
const LOGO = 84;

const vidrio = {
  backgroundColor: alfa(C.bg, 0.7),
  borderWidth: 1,
  borderColor: alfa(C.textPrimary, 0.14),
};

const styles = StyleSheet.create({
  banner: {
    height: ALTO_BANNER,
    backgroundColor: C.surface,
    borderBottomWidth: 2,
    overflow: 'hidden',
  },
  filaSuperior: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  acciones: { flexDirection: 'row', gap: 8 },
  filaInferior: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pildora: {
    ...vidrio,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  pildoraTexto: { color: C.textPrimary, fontSize: 13.5, fontFamily: F.bold },
  pildoraCuenta: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.textPrimary,
  },
  pildoraCuentaTexto: { color: C.bg, fontSize: 11, fontFamily: F.extraBold },
  botonRedondo: {
    ...vidrio,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonRedondoSolido: {
    backgroundColor: C.surface,
    borderColor: C.border,
  },
  chipFoto: {
    ...vidrio,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipFotoNumero: { color: C.textPrimary, fontSize: 12.5, fontFamily: F.extraBold },
  chipFotoTexto: { color: C.textSoft, fontSize: 12, fontFamily: F.semiBold },
  recordNumero: { color: C.textPrimary, fontSize: 12.5, fontFamily: F.extraBold },
  recordSeparado: { marginLeft: 6 },
  recordLetra: { color: C.textSoft, fontSize: 10, fontFamily: F.semiBold, marginLeft: 2 },

  filaLogo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginTop: -LOGO / 2,
  },
  lado: { flex: 1, paddingTop: LOGO / 2 + 8 },
  ladoDerecho: { alignItems: 'flex-end' },
  logoMarco: {
    width: LOGO,
    height: LOGO,
    borderRadius: LOGO / 2,
    padding: 4,
    backgroundColor: C.bg,
  },
  logoAro: {
    flex: 1,
    borderRadius: LOGO / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceAlt,
    overflow: 'hidden',
  },
  insignia: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.red,
    borderWidth: 2,
    borderColor: C.bg,
  },
  insigniaTexto: { color: C.textPrimary, fontSize: 10, fontFamily: F.extraBold },

  identidad: { alignItems: 'center', paddingHorizontal: 16, marginTop: 8 },
  nombreFila: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  nombre: {
    color: C.textPrimary,
    fontSize: 22,
    fontFamily: F.extraBold,
    letterSpacing: -0.3,
    textAlign: 'center',
    flexShrink: 1,
  },
  lugarFila: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  lugar: { color: C.textSecondary, fontSize: 13 },

  filaChips: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 14,
  },
  chipAccion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  chipAccionTexto: { color: C.textPrimary, fontSize: 13, fontFamily: F.bold },
  puntoRojo: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.red,
    borderWidth: 1.5,
    borderColor: C.surface,
  },
  presionado: { opacity: 0.75 },
});
