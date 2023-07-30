const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');

const app = express();

// Configurações do Discord OAuth
const clientId = 'SEU_CLIENT_ID';
const clientSecret = 'SEU_CLIENT_SECRET';
const redirectUri = 'http://localhost:3000/callback';

// Configuração da sessão
app.use(session({
  secret: 'seu_secret_sessao',
  resave: false,
  saveUninitialized: false,
}));

// Inicializar o Passport e a sessão
app.use(passport.initialize());
app.use(passport.session());

// Configuração da estratégia de autenticação do Discord
passport.use(new DiscordStrategy({
  clientID: clientId,
  clientSecret: clientSecret,
  callbackURL: redirectUri,
  scope: ['identify'],
},
(accessToken, refreshToken, profile, done) => {
  const user = {
    id: profile.id,
    username: profile.username,
    discriminator: profile.discriminator,
    avatar: profile.avatar,
  };
  return done(null, user);
}));

// Função para verificar se o usuário é um administrador (altere essa função conforme sua lógica de administração)
function isAdmin(user) {
  // Exemplo: Verifica se o usuário tem permissão de administrador no Discord
  return user.id === 'SEU_ID_DE_ADMINISTRADOR';
}

// Função de autenticação personalizada para verificar se o usuário está logado
function authenticate(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  } else {
    res.redirect('/login');
  }
}

// Estrutura de dados para armazenar as aplicações dos usuários
const userApplications = [];

// Configuração do multer para lidar com o upload do arquivo
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
  }
});

const upload = multer({ storage: storage });

// Rota inicial
app.get('/', authenticate, (req, res) => {
  const user = req.user;
  const userApp = userApplications.find((app) => app.owner === user.id);
  res.render('dashboard', { user: user.username, applications: userApp ? userApp.applications : [] });
});

// Rota para fazer login com Discord
app.get('/login', passport.authenticate('discord'));

// Rota de callback após a autenticação do Discord
app.get('/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});

// Rota para fazer logout
app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

// Rota para enviar uma nova aplicação (exclusivo para uso do bot do Discord)
app.post('/upload', (req, res) => {
  const { userId, appId, appName } = req.body;

  // Verificar se o usuário é o bot do Discord (substitua 'SEU_BOT_ID' pelo ID do seu bot)
  if (userId !== 'SEU_BOT_ID') {
    return res.status(403).send('Apenas o bot do Discord pode enviar novas aplicações.');
  }

  // Exemplo: Salvando a nova aplicação no usuário
  const userApp = userApplications.find((app) => app.owner === userId);
  if (userApp) {
    userApp.applications.push({
      id: appId, // O ID é fornecido pelo bot do Discord
      name: appName,
      status: 'stopped',
      terminal: '',
    });
  } else {
    userApplications.push({
      owner: userId,
      applications: [
        {
          id: appId, // O ID é fornecido pelo bot do Discord
          name: appName,
          status: 'stopped',
          terminal: '',
        },
      ],
    });
  }

  res.send('Aplicação enviada com sucesso!');
});

// Rota para visualizar detalhes da aplicação
app.get('/app/:appId', authenticate, (req, res) => {
  const user = req.user;
  const appId = req.params.appId;

  // Verificar se o usuário é o proprietário da aplicação com base no ID da aplicação
  const application = findApplicationById(user.id, appId);

  if (!application) {
    return res.status(403).send('Você não tem permissão para visualizar os detalhes desta aplicação.');
  }

  // Aqui você pode adicionar lógica para obter mais informações sobre a aplicação,
  // como o terminal ou outras configurações específicas da aplicação.

  // Para este exemplo, estou apenas enviando informações mínimas para a página.
  const appData = {
    appName: application.name,
    appStatus: application.status,
    appTerminal: 'Terminal da aplicação.\nLogs e comandos interativos serão exibidos aqui.',
    appId: application.id,
    isAdmin: isAdmin(user),
  };

  res.render('app-details', appData);
});


// Rota para remover a aplicação

app.post('/remove', authenticate, (req, res) => {
  const user = req.user;
  const { userId, appId } = req.body;

  // Verificar se o usuário é o bot do Discord (substitua 'SEU_BOT_ID' pelo ID do seu bot)
  if (userId !== 'SEU_BOT_ID') {
    return res.status(403).send('Apenas o bot do Discord pode remover aplicações.');
  }

  // Encontre a aplicação do usuário pelo ID
  const application = findApplicationById(userId, appId);

  if (!application) {
    return res.status(404).send('Aplicação não encontrada.');
  }

  // Remova a aplicação
  const userApp = userApplications.find((app) => app.owner === userId);
  if (userApp) {
    userApp.applications = userApp.applications.filter((app) => app.id !== appId);
  }

  res.send('Aplicação removida com sucesso!');
});

// Função para encontrar a aplicação pelo ID da aplicação e ID do usuário
function findApplicationById(userId, appId) {
  const userApp = userApplications.find((app) => app.owner === userId);
  return userApp ? userApp.applications.find((app) => app.id === appId) : undefined;
}

// Rota para iniciar, reiniciar ou parar uma aplicação
app.post('/action', authenticate, (req, res) => {
  const user = req.user;
  const { appId, action } = req.body;

  // Verificar se o usuário é o bot do Discord (substitua 'SEU_BOT_ID' pelo ID do seu bot)
  if (user.id === 'SEU_BOT_ID') {
    // Encontre a aplicação do usuário pelo ID
    const application = findApplicationById(user.id, appId);

    if (application) {
      // Executar a ação (iniciar, reiniciar ou parar) na aplicação.
      // Você precisará adicionar lógica aqui para iniciar, reiniciar ou parar a aplicação, dependendo da tecnologia usada (por exemplo, Node.js, PM2, etc.).
      // O código a seguir é apenas um exemplo.

      if (action === 'start') {
        application.status = 'started';
        // Lógica para iniciar a aplicação
      } else if (action === 'restart') {
        // Lógica para reiniciar a aplicação
      } else if (action === 'stop') {
        application.status = 'stopped';
        // Lógica para parar a aplicação
      }

      // Redirecionar para a página de detalhes da aplicação após executar a ação
      res.send('Ação realizada com sucesso!');
      return;
    }

    // Caso a aplicação não seja encontrada ou a ação seja inválida
    res.status(404).send('Aplicação não encontrada ou ação inválida.');
  } else {
    res.status(403).send('Apenas o bot do Discord pode executar ações nas aplicações.');
  }
});

// Definir a porta em que o servidor irá escutar
const port = 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
