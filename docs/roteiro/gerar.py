# -*- coding: utf-8 -*-
import datetime, os, sys

# roda de qualquer diretório: o módulo do conteúdo é vizinho deste arquivo
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from conteudo import INTRO, ENDERECOS, AVISOS, ETAPAS, FINAL

# o PDF é o artefato entregue; fica um nível acima, junto da documentação
SAIDA = os.path.join(AQUI, os.pardir, 'roteiro-de-teste-apitofut.pdf')

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether, PageBreak)

VERDE = colors.HexColor('#16A34A')
VERDE_ESC = colors.HexColor('#14532D')
TINTA = colors.HexColor('#0F172A')
TINTA2 = colors.HexColor('#475569')
LINHA = colors.HexColor('#E2E8F0')
FUNDO = colors.HexColor('#F8FAFC')
AMBAR = colors.HexColor('#B45309')

ss = getSampleStyleSheet()

def st(nome, **kw):
    base = dict(name=nome, fontName='Helvetica', fontSize=9.5, leading=13.5,
                textColor=TINTA, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(**base)

S = {
  'h1':     st('h1', fontName='Helvetica-Bold', fontSize=17, leading=21,
               textColor=VERDE_ESC, spaceBefore=6, spaceAfter=3),
  'h2':     st('h2', fontName='Helvetica-Bold', fontSize=11.5, leading=15,
               textColor=VERDE_ESC, spaceBefore=12, spaceAfter=4),
  'corpo':  st('corpo', spaceAfter=5),
  'peq':    st('peq', fontSize=8.5, leading=12, textColor=TINTA2),
  'acao':   st('acao', fontSize=9.5, leading=13.5),
  'esp':    st('esp', fontSize=9, leading=12.5, textColor=VERDE_ESC),
  'obs':    st('obs', fontSize=8.8, leading=12.5, textColor=AMBAR),
  'capa_t': st('capa_t', fontName='Helvetica-Bold', fontSize=30, leading=34,
               textColor=VERDE_ESC),
  'capa_s': st('capa_s', fontSize=13, leading=18, textColor=TINTA2),
  'num':    st('num', fontName='Helvetica-Bold', fontSize=9.5, leading=13.5,
               textColor=VERDE),
}

def rodape(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINHA); canvas.setLineWidth(0.5)
    canvas.line(20*mm, 15*mm, 190*mm, 15*mm)
    canvas.setFont('Helvetica', 7.5); canvas.setFillColor(TINTA2)
    canvas.drawString(20*mm, 10.5*mm, 'ApitoFut · Roteiro de teste')
    if doc.page > 1:
        canvas.drawRightString(190*mm, 10.5*mm, f'{doc.page}')
    canvas.restoreState()

hist = []

# ── capa ──────────────────────────────────────────────────────────────
hist.append(Spacer(1, 42*mm))
hist.append(Paragraph('Roteiro de teste', S['capa_t']))
hist.append(Paragraph('ApitoFut · plataforma de gestão de competições', S['capa_s']))
hist.append(Spacer(1, 8*mm))
hist.append(Table([['']], colWidths=[52*mm], rowHeights=[2.5],
                  style=TableStyle([('BACKGROUND',(0,0),(-1,-1),VERDE)])))
hist.append(Spacer(1, 10*mm))
hist.append(Paragraph(
    'Um percurso do começo ao fim: criar a conta, montar o campeonato, inscrever '
    'equipes e atletas, operar os jogos, acompanhar o portal e encerrar a '
    'competição. Cada passo diz o que fazer e o que esperar.', S['capa_s']))
hist.append(Spacer(1, 30*mm))
hist.append(Paragraph(
    f'Gerado em {datetime.date.today().strftime("%d/%m/%Y")} · 16 etapas · 2ª edição',
    S['peq']))
hist.append(PageBreak())

# ── introdução ────────────────────────────────────────────────────────
hist.append(Paragraph('Antes de começar', S['h1']))
hist.append(Spacer(1, 3*mm))
for titulo, texto in INTRO:
    hist.append(Paragraph(titulo, S['h2']))
    hist.append(Paragraph(texto, S['corpo']))

hist.append(Paragraph('Endereços', S['h2']))
linhas = [[Paragraph('<b>Onde</b>', S['peq']), Paragraph('<b>Endereço</b>', S['peq']),
           Paragraph('<b>O que é</b>', S['peq'])]]
for nome, url, desc in ENDERECOS:
    linhas.append([Paragraph(nome, S['peq']),
                   Paragraph(f'<font color="#14532D">{url}</font>', S['peq']),
                   Paragraph(desc, S['peq'])])
t = Table(linhas, colWidths=[34*mm, 66*mm, 62*mm])
t.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,0), FUNDO),
    ('GRID',(0,0),(-1,-1), 0.4, LINHA),
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('LEFTPADDING',(0,0),(-1,-1),5), ('RIGHTPADDING',(0,0),(-1,-1),5),
    ('TOPPADDING',(0,0),(-1,-1),4), ('BOTTOMPADDING',(0,0),(-1,-1),4),
]))
hist.append(t)

hist.append(Paragraph('Avisos', S['h2']))
for a in AVISOS:
    hist.append(Paragraph(f'•&nbsp;&nbsp;{a}', S['corpo']))
hist.append(PageBreak())

# ── etapas ────────────────────────────────────────────────────────────
for et in ETAPAS:
    bloco = []
    cab = Table([[Paragraph(f'<b>ETAPA {et["n"]}</b>', S['num']),
                  Paragraph(f'<b>{et["titulo"]}</b>',
                            st('x', fontName='Helvetica-Bold', fontSize=13,
                               leading=17, textColor=VERDE_ESC))]],
                colWidths=[22*mm, 140*mm])
    cab.setStyle(TableStyle([
        ('VALIGN',(0,0),(-1,-1),'BOTTOM'),
        ('LEFTPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),1),
        ('LINEBELOW',(0,0),(-1,-1), 1.2, VERDE),
        ('TOPPADDING',(0,0),(-1,-1),0),
    ]))
    bloco.append(cab)
    bloco.append(Spacer(1, 2*mm))
    bloco.append(Paragraph(f'<i>{et["objetivo"]}</i>', S['peq']))
    bloco.append(Spacer(1, 3*mm))
    hist.append(KeepTogether(bloco))

    for i, (acao, esperado) in enumerate(et['passos'], 1):
        # quadrado DESENHADO, não caractere: Helvetica não tem o glifo de
        # caixa de marcar, e ele sairia como vazio ou como tarja preta
        caixa = Table([['']], colWidths=[3.6*mm], rowHeights=[3.6*mm],
                      style=TableStyle([('BOX',(0,0),(-1,-1), 0.7, TINTA2)]))
        linhas = [[
            caixa,
            Paragraph(f'<b>{et["n"]}.{i}</b>', S['num']),
            Paragraph(acao, S['acao']),
        ], [
            '', '',
            Paragraph(f'<b>Esperado:</b> {esperado}', S['esp']),
        ]]
        p = Table(linhas, colWidths=[7*mm, 11*mm, 144*mm])
        p.setStyle(TableStyle([
            ('VALIGN',(0,0),(-1,-1),'TOP'),
            ('LEFTPADDING',(0,0),(-1,-1),0), ('RIGHTPADDING',(0,0),(-1,-1),2),
            ('TOPPADDING',(0,0),(0,0),4), ('TOPPADDING',(1,0),(-1,0),3), ('BOTTOMPADDING',(0,0),(-1,0),2),
            ('TOPPADDING',(0,1),(-1,1),0), ('BOTTOMPADDING',(0,1),(-1,1),6),
            ('BACKGROUND',(2,1),(2,1), colors.HexColor('#F0FDF4')),
            ('LEFTPADDING',(2,1),(2,1),6), ('RIGHTPADDING',(2,1),(2,1),6),
            ('TOPPADDING',(2,1),(2,1),4), ('BOTTOMPADDING',(2,1),(2,1),4),
        ]))
        hist.append(KeepTogether([p]))

    if et.get('observar'):
        obs = Table([[Paragraph(f'<b>Repare:</b> {et["observar"]}', S['obs'])]],
                    colWidths=[162*mm])
        obs.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,-1), colors.HexColor('#FFFBEB')),
            ('BOX',(0,0),(-1,-1), 0.5, colors.HexColor('#FCD34D')),
            ('LEFTPADDING',(0,0),(-1,-1),7), ('RIGHTPADDING',(0,0),(-1,-1),7),
            ('TOPPADDING',(0,0),(-1,-1),5), ('BOTTOMPADDING',(0,0),(-1,-1),5),
        ]))
        hist.append(Spacer(1, 1*mm))
        hist.append(KeepTogether([obs]))
    hist.append(Spacer(1, 7*mm))

# ── fechamento ────────────────────────────────────────────────────────
hist.append(PageBreak())
hist.append(Paragraph('Ao terminar', S['h1']))
hist.append(Spacer(1, 3*mm))
for titulo, texto in FINAL:
    hist.append(Paragraph(titulo, S['h2']))
    hist.append(Paragraph(texto, S['corpo']))

hist.append(Spacer(1, 8*mm))
hist.append(Paragraph('Anotações', S['h2']))
for _ in range(16):
    hist.append(Table([['']], colWidths=[162*mm], rowHeights=[9*mm],
                      style=TableStyle([('LINEBELOW',(0,0),(-1,-1),0.4,LINHA)])))

doc = BaseDocTemplate(SAIDA, pagesize=A4,
                      leftMargin=20*mm, rightMargin=20*mm,
                      topMargin=18*mm, bottomMargin=20*mm,
                      title='Roteiro de teste — ApitoFut', author='ApitoFut')
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=rodape)])
doc.build(hist)
print(f'PDF gerado em {os.path.normpath(SAIDA)}')
