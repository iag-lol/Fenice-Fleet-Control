import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Driver, Order, Vehicle, WorkOrder } from '@/types/core';

export interface WorkOrderDocument {
  workOrder: WorkOrder; order: Order | null; vehicle: Vehicle | null; driver: Driver | null;
  simulated: boolean; generatedAt?: Date;
}

const NAVY = rgb(.07, .16, .24), INK = rgb(.12, .19, .27), MUTED = rgb(.4, .46, .52);
const LIGHT = rgb(.94, .96, .98), LINE = rgb(.83, .87, .91);
const liters = (value: number) => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value)} L`;
const dateTime = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Santiago' }).format(new Date(value)) : 'Sin registro';

/** Pure generator: A4, wrapped fields, multipage tables; never writes business records. */
export async function buildWorkOrderPdf(data: WorkOrderDocument): Promise<Uint8Array> {
  const { workOrder, vehicle, driver } = data;
  const order = data.order?.clientId === workOrder.clientId && data.order.locationId === workOrder.locationId ? data.order : null;
  const doc = await PDFDocument.create();
  doc.setTitle(`Orden de trabajo ${workOrder.number}`);
  doc.setAuthor('Fenice SpA');
  doc.setCreationDate(data.generatedAt ?? new Date());
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Standard PDF fonts cover Spanish accents. Unsupported symbols never abort a download.
  const safe = (text: string) => Array.from(text.normalize('NFC')).map((char) => {
    if (char === '\n' || char === '\r' || char === '\t') return ' ';
    try { regular.encodeText(char); return char; } catch { return '?'; }
  }).join('');
  const wrap = (value: string, width: number, font: PDFFont, size: number): string[] => {
    const rows: string[] = [];
    let row = '';
    for (const word of safe(value).split(/\s+/)) {
      if (font.widthOfTextAtSize(`${row}${row ? ' ' : ''}${word}`, size) <= width) { row += `${row ? ' ' : ''}${word}`; continue; }
      if (row) { rows.push(row); row = ''; }
      for (const char of word) {
        if (font.widthOfTextAtSize(row + char, size) > width && row) { rows.push(row); row = ''; }
        row += char;
      }
    }
    if (row) rows.push(row);
    return rows.length ? rows : ['Sin registro'];
  };
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage(PageSizes.A4);
    page.drawRectangle({ x: 0, y: 748, width: 595.28, height: 94, color: NAVY });
    page.drawText('FENICE / CONTROL DE FLOTA', { x: 42, y: 808, size: 10, font: bold, color: rgb(.6, .78, .9) });
    page.drawText('Orden de trabajo', { x: 42, y: 777, size: 23, font: bold, color: rgb(1, 1, 1) });
    const number = wrap(workOrder.number, 235, bold, 11)[0]!;
    page.drawText(number, { x: 330, y: 780, size: 11, font: bold, color: rgb(1, 1, 1) });
    if (data.simulated) page.drawText('DEMOSTRACION - DATOS FICTICIOS', { x: 42, y: 727, size: 9, font: bold, color: rgb(.75, .2, .12) });
    y = data.simulated ? 702 : 720;
  };
  const room = (height: number) => { if (y - height < 78) newPage(); };
  const text = (value: string, options: { size?: number; weight?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = options.size ?? 10, font = options.weight ? bold : regular, indent = options.indent ?? 0;
    for (const line of wrap(value, 511 - indent, font, size)) {
      room(size + 6);
      page.drawText(line, { x: 42 + indent, y, size, font, color: options.color ?? INK });
      y -= size + 5;
    }
  };
  const section = (label: string) => { room(52); y -= 17; text(label.toUpperCase(), { size: 10, weight: true, color: NAVY }); y -= 5; };
  const field = (label: string, value: string | null | undefined) => { text(label, { size: 8, color: MUTED }); text(value || 'Sin registro', { size: 11 }); y -= 8; };
  newPage();
  text(`Pedido ${workOrder.orderNumber}  |  Estado: ${workOrder.status.replaceAll('_', ' ')}`, { size: 10 });
  section('Cliente y destino');
  field('CLIENTE', workOrder.clientName);
  field('DOMICILIO DE ENTREGA', `${workOrder.addressLine}, ${workOrder.communeName}`);
  field('PROGRAMACION (AMERICA/SANTIAGO)', `${dateTime(workOrder.scheduledWindowStart ?? workOrder.scheduledDate)}${workOrder.scheduledWindowEnd ? ` a ${dateTime(workOrder.scheduledWindowEnd)}` : ''}`);
  section('Asignacion');
  field('VEHICULO / CONDUCTOR', `${vehicle?.plate ?? 'Sin vehiculo asignado'} / ${driver?.fullName ?? 'Sin conductor asignado'}`);
  section('Combustible programado');
  if (!order) text('No hay detalle de productos disponible para esta orden.');
  else {
    const heading = () => {
      room(35);
      page.drawRectangle({ x: 42, y: y - 5, width: 511, height: 25, color: NAVY });
      page.drawText('PRODUCTO / COMPARTIMENTO', { x: 52, y: y + 3, size: 8, font: bold, color: rgb(1, 1, 1) });
      page.drawText('LITROS', { x: 483, y: y + 3, size: 8, font: bold, color: rgb(1, 1, 1) }); y -= 26;
    };
    heading();
    for (const item of order.lines) {
      const label = `${item.description}${item.compartment !== null ? ` / Compartimento ${item.compartment}` : ''}`;
      const rows = wrap(label, 365, regular, 10);
      const numeric = Number.isFinite(item.liters) && item.liters >= 0 ? liters(item.liters) : 'Sin dato';
      // A very long product can continue on another page without clipping.
      for (let i = 0; i < rows.length; i++) {
        if (y - 25 < 78) { newPage(); section('Combustible programado (continuacion)'); heading(); }
        page.drawRectangle({ x: 42, y: y - 6, width: 511, height: 21, color: LIGHT });
        page.drawText(rows[i]!, { x: 52, y, size: 10, font: regular, color: INK });
        if (i === 0) page.drawText(numeric, { x: 543 - regular.widthOfTextAtSize(numeric, 10), y, size: 10, font: regular, color: INK });
        y -= 21;
      }
      y -= 5;
    }
    y -= 8;
    const total = order.lines.length && order.lines.every((item) => Number.isFinite(item.liters) && item.liters >= 0)
      ? liters(order.lines.reduce((sum, item) => sum + item.liters, 0)) : 'Sin volumen confirmado';
    text(`TOTAL PROGRAMADO: ${total}`, { weight: true, size: 13 });
  }
  section('Registro de visita');
  field('LLEGADA / SALIDA REGISTRADAS', `${dateTime(workOrder.actualArrivalAt)} / ${dateTime(workOrder.actualDepartureAt)}`);
  text(`Confirmacion: ${workOrder.deliveryConfirmation === 'none' ? 'Sin confirmacion' : workOrder.deliveryConfirmation.toUpperCase()}`, { size: 10 });
  text('Los litros son el volumen programado. La presencia GPS no mide combustible descargado.', { size: 9, color: MUTED });
  if (workOrder.notes || order?.notes) { section('Observaciones'); if (workOrder.notes) text(workOrder.notes); if (order?.notes && order.notes !== workOrder.notes) text(order.notes); }
  const generated = dateTime((data.generatedAt ?? new Date()).toISOString());
  doc.getPages().forEach((sheet, index) => {
    sheet.drawLine({ start: { x: 42, y: 56 }, end: { x: 553, y: 56 }, color: LINE, thickness: 1 });
    sheet.drawText(`Emitido ${generated} - Documento operacional`, { x: 42, y: 39, font: regular, size: 8, color: MUTED });
    sheet.drawText(`${index + 1} / ${doc.getPageCount()}`, { x: 519, y: 39, font: regular, size: 8, color: MUTED });
  });
  return doc.save();
}
