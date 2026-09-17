export async function generateFiadoPdf(customer, history) {
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const fmt = n => '$' + (n ?? 0).toLocaleString('es-CO');
  const fmtDate = d => new Date(d).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('⚡ Studio Store', 14, 12);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('GlamourCam Studio · Reporte de cuenta', 14, 19);
  doc.text('Generado: ' + fmtDate(new Date()), 14, 24);

  // Customer card
  doc.setTextColor(15, 23, 42);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, 33, 182, 26, 3, 3, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(customer.emoji + ' ' + customer.name, 20, 42);
  if (customer.tag) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(customer.tag, 20, 48);
  }
  // Balance box
  const balColor = customer.balance > 0 ? [239, 68, 68] : [34, 197, 94];
  doc.setFillColor(...balColor);
  doc.roundedRect(140, 34, 52, 14, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(fmt(customer.balance), 166, 43, { align: 'center' });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('SALDO PENDIENTE', 166, 54, { align: 'center' });
  doc.setTextColor(100, 116, 139);
  doc.text('Límite: ' + fmt(customer.credit_limit), 166, 58, { align: 'center' });

  let y = 66;

  // Credit sales
  const creditSales = history.filter(r => r.kind === 'credit' && !r.voided);
  if (creditSales.length > 0) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Fiados pendientes', 14, y);
    y += 4;

    for (const sale of creditSales) {
      const items = sale.sale_items ?? [];
      const rows = items.map(i => [
        (i.products?.emoji ?? '') + ' ' + (i.products?.name ?? 'Producto'),
        String(i.qty),
        fmt(i.unit_price),
        fmt(i.qty * i.unit_price),
      ]);
      if (rows.length === 0) rows.push(['-', '-', '-', fmt(sale.amt)]);

      doc.autoTable({
        startY: y,
        head: [[
          { content: fmtDate(sale.created_at), colSpan: 3, styles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 8 } },
          { content: fmt(sale.amt), styles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8, halign: 'right' } },
        ]],
        body: rows,
        columns: [
          { header: 'Producto', dataKey: 0 },
          { header: 'Cant', dataKey: 1 },
          { header: 'Precio', dataKey: 2 },
          { header: 'Total', dataKey: 3 },
        ],
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        margin: { left: 14, right: 14 },
        showHead: 'firstPage',
        didParseCell: (data) => {
          if (data.section === 'head' && data.row.index === 0) return; // date row handled
        },
        theme: 'plain',
      });
      y = doc.lastAutoTable.finalY + 3;
    }
  }

  // Payments
  const pays = history.filter(r => r.kind === 'pay' && !r.voided);
  if (pays.length > 0) {
    y += 3;
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Abonos realizados', 14, y);
    y += 2;

    doc.autoTable({
      startY: y,
      head: [['Fecha', 'Método', 'Monto', 'Nota']],
      body: pays.map(p => [
        fmtDate(p.created_at),
        p.method === 'cash' ? 'Efectivo' : 'Transferencia',
        fmt(p.amt),
        p.note ?? '-',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 197, 94], textColor: [255, 255, 255] },
      columnStyles: { 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
      theme: 'striped',
    });
    y = doc.lastAutoTable.finalY + 3;
  }

  // Summary footer
  const totalFiado = creditSales.reduce((s, r) => s + r.amt, 0);
  const totalAbonado = pays.reduce((s, r) => s + r.amt, 0);

  y += 4;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(14, y, 182, 22, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Total fiado:', 20, y + 7);
  doc.text(fmt(totalFiado), 100, y + 7, { align: 'right' });
  doc.text('Total abonado:', 20, y + 13);
  doc.text(fmt(totalAbonado), 100, y + 13, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Saldo pendiente:', 110, y + 13);
  doc.text(fmt(customer.balance), 193, y + 13, { align: 'right' });

  // Page number
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Studio Store · GlamourCam Studio', 105, 292, { align: 'center' });

  doc.save('fiado-' + customer.name.toLowerCase().replace(/\s+/g, '-') + '.pdf');
}
