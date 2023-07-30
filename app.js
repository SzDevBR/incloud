const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const { exec } = require('child_process');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { admin, db } = require('./firebase');
const Discord = require('discord.js');

const app = express();
const port = process.env.PORT || 3000;
const botToken = 'SEU_TOKEN_DISCORD'; // Substitua pelo token do bot do Discord
const serverId = 'SEU_ID_SERVIDOR_DISCORD'; // Substitua pelo ID do servidor do Discord

app.use(fileUpload());
app.use(express.static('public'));
app.use(
  session({
    secret: 'sua_chave_secreta',
    resave: false,
    saveUninitialized: true,
  })
);

// Array para armazenar as aplicações do usuário
const userApplications = [];

// Middleware de autenticação para verificar se o usuário está logado
const authenticate = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/discord');
};

// Inicializar o Passport.js
app.use(passport.initialize());
app.use(passport.session());

// Configuração da estratégia de autenticação do Discord
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ['identify', 'guilds'],
    },
    (accessToken, refreshToken, profile, done) => {
      // Função de callback chamada após a autenticação bem-sucedida
      // Aqui você pode salvar as informações do usuário no banco de dados ou na sessão.
      // Por exemplo, você pode salvar o ID do usuário, nome, e-mail, etc.
      return done(null, profile);
    }
  )
);

// Serialização do usuário para armazenar na sessão
passport.serializeUser((user, done) => {
  done(null, user);
});

// Desserialização do usuário ao ler da sessão
passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Rota para autenticar o usuário usando o Discord
app.get('/auth/discord', passport.authenticate('discord'));

// Rota para o retorno após a autenticação do Discord
app.get(
  '/auth/discord/callback',
  passport.authenticate('discord', {
    failureRedirect: '/login',
    successRedirect: '/',
  })
);

// Rota para a página de painel de controle
app.get('/', authenticate, (req, res) => {
  const user = req.user;
  const userApp = userApplications.find((app) => app.owner === user.id);
  res.render('dashboard', { user: user.username, applications: userApp ? userApp.applications : [] });
});

// Rota para a página de upload
app.get('/upload', authenticate, (req, res) => {
  res.render('upload');
});

// Rota para o processamento do upload
app.post('/upload', authenticate, (req, res) => {
  if (!req.files || !req.files.app) {
    return res.status(400).send('Nenhum arquivo foi enviado.');
  }

  const appFile = req.files.app;

  // Verificar se é um arquivo zip
  if (!appFile.name.endsWith('.zip')) {
    return res.status(400).send('Apenas arquivos zip são permitidos.');
  }

  // Criar um diretório temporário para extrair o conteúdo do zip
  const tempDir = __dirname + '/temp';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  // Mover o arquivo zip para o diretório temporário
  const filePath = tempDir + '/' + appFile.name;
  appFile.mv(filePath, (err) => {
    if (err) {
      return res.status(500).send(err);
    }

    // Extrair o conteúdo do zip
    exec(`unzip ${filePath} -d ${tempDir}`, (error) => {
      if (error) {
        return res.status(500).send(error);
      }

      // A aplicação foi extraída, agora você pode fazer a implantação em um local apropriado (por exemplo, usando o PM2 ou outro gerenciador de processos)

      // Exemplo: Implantar a aplicação usando o PM2
      exec('pm2 start app.js', { cwd: tempDir }, (err, stdout, stderr) => {
        if (err) {
          return res.status(500).send(err);
        }

        // A aplicação foi implantada com sucesso!
        res.send('Aplicação implantada com sucesso!');

        // Nota: Neste ponto, você também pode configurar um mecanismo de limpeza para excluir os arquivos temporários e zip após a implantação.
      });
    });
  });
});

// Rota para iniciar, reiniciar ou parar uma aplicação
app.post('/action', authenticate, (req, res) => {
  const user = req.user;
  const { appName, action } = req.body;

  // Encontre a aplicação do usuário pelo nome
  const userApp = userApplications.find((app) => app.owner === user.id);

  if (userApp) {
    const application = userApp.applications.find((app) => app.name === appName);
    if (application) {
      // Executar a ação (iniciar, reiniciar ou parar) na aplicação.
      // Você precisará adicionar lógica aqui para iniciar, reiniciar ou parar a aplicação, dependendo da tecnologia usada (por exemplo, Node.js, PM2, etc.).
      // O código a seguir é apenas um exemplo básico.

      if (action === 'start') {
        application.status = 'started';
        // Lógica para iniciar a aplicação
      } else if (action === 'restart') {
        // Lógica para reiniciar a aplicação
      } else if (action === 'stop') {
        application.status = 'stopped';
        // Lógica para parar a aplicação
      }

      // Redirecionar para o painel após executar a ação
      res.redirect('/');
      return;
    }
  }

  // Caso a aplicação não seja encontrada ou a ação seja inválida
  res.status(404).send('Aplicação não encontrada ou ação inválida.');
});

// Rota para banir um usuário
app.post('/ban', authenticate, async (req, res) => {
  const user = req.user;
  const { userIdToBan } = req.body;

  // Verificar se o usuário que enviou é um administrador no Discord
  if (!isAdmin(user)) {
    return res.status(403).send('Você não tem permissão para banir usuários.');
  }

  // Banir o usuário da plataforma de hospedagem
  const isBannedOnPlatform = await banUserFromPlatform(userIdToBan);
  if (!isBannedOnPlatform) {
    return res.status(500).send('Ocorreu um erro ao banir o usuário da plataforma de hospedagem.');
  }

  // Obter o membro do servidor para o usuário a ser banido no Discord
  const memberToBan = bot.guilds.cache.get(serverId)?.members.cache.get(userIdToBan);
  if (!memberToBan) {
    return res.status(404).send('Usuário não encontrado no servidor do Discord.');
  }

  // Banir o usuário do servidor do Discord
  try {
    await memberToBan.ban();
    return res.send('Usuário banido da plataforma de hospedagem e do servidor do Discord.');
  } catch (error) {
    console.error('Erro ao banir usuário do Discord:', error);
    return res.status(500).send('Ocorreu um erro ao banir o usuário do servidor do Discord.');
  }
});

// Rota para sair (logout)
app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor iniciado na porta ${port}`);
});

// Função para verificar se um usuário é um administrador no Discord
function isAdmin(user) {
  // Substitua essa lógica de acordo com os critérios para considerar um usuário como administrador no Discord.
  // Neste exemplo, estamos verificando se o usuário é o dono do servidor.
  return user.guilds.some((guild) => guild.ownerID === user.id);
}

// Função para banir o usuário da plataforma de hospedagem
async function banUserFromPlatform(userId) {
  // Aqui você pode adicionar a lógica para banir o usuário da plataforma de hospedagem.
  // Por exemplo, você pode armazenar os IDs dos usuários banidos em uma coleção no Firebase e verificar essa lista antes de permitir que o usuário acesse o painel de controle.

  // Substitua o código abaixo pela sua própria lógica de banimento na plataforma de hospedagem.
  // Neste exemplo, estamos apenas retornando "true" para indicar que o usuário foi banido.
  return true;
}
