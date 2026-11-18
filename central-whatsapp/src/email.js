import nodemailer from "nodemailer";

/**
 * Envio de e-mails da central (hoje, só a redefinição de senha).
 * Sem SMTP configurado, o e-mail é mostrado no terminal, para uso em testes.
 */
export function criarEnviadorDeEmail({ smtp, log = console }) {
  if (!smtp.host) {
    return {
      configurado: false,
      async enviar({ para, assunto, texto }) {
        log.warn(`\n[SMTP não configurado: e-mail mostrado aqui em vez de enviado]\nPara: ${para}\nAssunto: ${assunto}\n\n${texto}\n`);
      },
    };
  }
  const transporte = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.porta,
    secure: smtp.porta === 465, // 465 = TLS direto; 587/25 = STARTTLS
    auth: smtp.usuario ? { user: smtp.usuario, pass: smtp.senha } : undefined,
  });
  return {
    configurado: true,
    enviar: ({ para, assunto, texto, html }) =>
      transporte.sendMail({ from: smtp.remetente, to: para, subject: assunto, text: texto, html }),
  };
}

const escapar = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function mensagemDeRedefinicao({ nome, link, validadeMinutos, marca }) {
  const assunto = `${marca.nome}: redefinição de senha da Central de Atendimento`;
  const texto = [
    `Olá, ${nome}.`,
    "",
    `Recebemos um pedido para redefinir a sua senha da Central de Atendimento da ${marca.nome}.`,
    `Para criar uma nova senha, abra o link abaixo (ele vale por ${validadeMinutos} minutos e só pode ser usado uma vez):`,
    "",
    link,
    "",
    "Se você não pediu isso, ignore este e-mail: a sua senha atual continua valendo.",
  ].join("\n");
  const cor = marca.cores.primaria;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F3F5FA;font-family:Arial,Helvetica,sans-serif;color:#0B1F4D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:${escapar(cor)};border-bottom:4px solid ${escapar(marca.cores.destaque)};padding:20px 28px;font-size:22px;font-weight:bold;color:${escapar(marca.cores.destaque)}">${escapar(marca.nome)}</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px">Olá, ${escapar(nome)}.</p>
<p style="margin:0 0 20px">Recebemos um pedido para redefinir a sua senha da Central de Atendimento. O link vale por ${validadeMinutos} minutos e só pode ser usado uma vez.</p>
<p style="margin:0 0 24px"><a href="${escapar(link)}" style="display:inline-block;background:${escapar(cor)};color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Criar nova senha</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#4A5677">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
<p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${escapar(link)}" style="color:${escapar(cor)}">${escapar(link)}</a></p>
<p style="margin:0;font-size:13px;color:#4A5677">Se você não pediu isso, ignore este e-mail: a sua senha atual continua valendo.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { assunto, texto, html };
}
