const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');

const app = express();

require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

// ...

const clientId = process.env.DISCORD_CLIENT_ID; // Substitua pelo nome da variável do token do cliente do Discord no .env
const clientSecret = process.env.DISCORD_CLIENT_SECRET; // Substitua pelo nome da variável do segredo do cliente do Discord no .env
const redirectUri = process.env.DISCORD_REDIRECT_URI; // Substitua pelo nome da variável da URL de redirecionamento do Discord no .env
const botToken = process.env.DISCORD_BOT_TOKEN; // Substitua pelo nome da variável do token do bot do Discord no .env

// ...


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

// Configurar o Firebase
const serviceAccount = require('./firebase'); // Substitua pelo caminho para o arquivo JSON das credenciais do Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://inderuxhostdiscord-default-rtdb.firebaseio.com/', // Substitua pela URL do seu projeto Firebase Realtime Database
});
const db = admin.database();

// Função para verificar se o usuário é um administrador (altere essa função conforme sua lógica de administração)
function isAdmin(user) {
  // Exemplo: Verifica se o usuário tem permissão de administrador no Discord
  return user.id === '811756391726710815';
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
const userApplicationsRef = db.ref('userApplications');

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

  // Buscar as aplicações do usuário no Firebase Realtime Database
  userApplicationsRef.child(user.id).once('value')
    .then((snapshot) => {
      const userApps = snapshot.val();
      const applications = userApps ? Object.values(userApps.applications) : [];
      res.render('dashboard', { user: user.username, applications });
    })
    .catch((error) => {
      console.error('Erro ao buscar as aplicações do usuário:', error);
      res.status(500).send('Ocorreu um erro ao buscar as aplicações do usuário.');
    });
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
  if (userId !== '1135054553306365962') {
    return res.status(403).send('Apenas o bot do Discord pode enviar novas aplicações.');
  }

  // Exemplo: Salvando a nova aplicação no Firebase Realtime Database
  userApplicationsRef.child(userId).child('applications').child(appId).set({
    id: appId, // O ID é fornecido pelo bot do Discord
    name: appName,
    status: 'stopped',
    terminal: '',
  })
  .then(() => {
    res.send('Aplicação enviada com sucesso!');
  })
  .catch((error) => {
    console.error('Erro ao enviar a aplicação:', error);
    res.status(500).send('Ocorreu um erro ao enviar a aplicação.');
  });
});

// Rota para visualizar detalhes da aplicação
app.get('/app/:appId', authenticate, (req, res) => {
  const user = req.user;
  const appId = req.params.appId;

  // Verificar se o usuário é o proprietário da aplicação pelo ID da aplicação
  userApplicationsRef.child(user.id).child('applications').child(appId).once('value')
    .then((snapshot) => {
      const application = snapshot.val();
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
    })
    .catch((error) => {
      console.error('Erro ao buscar a aplicação:', error);
      res.status(500).send('Ocorreu um erro ao buscar a aplicação.');
    });
});


// Rota para remover a aplicação
app.post('/remove', authenticate, (req, res) => {
  const user = req.user;
  const { userId, appId } = req.body;

  // Verificar se o usuário é o bot do Discord (substitua 'SEU_BOT_ID' pelo ID do seu bot)
  if (userId !== '1135054553306365962') {
    return res.status(403).send('Apenas o bot do Discord pode remover aplicações.');
  }

  // Encontre a aplicação do usuário pelo ID
  userApplicationsRef.child(userId).child('applications').child(appId).remove()
    .then(() => {
      res.send('Aplicação removida com sucesso!');
    })
    .catch((error) => {
      console.error('Erro ao remover a aplicação:', error);
      res.status(500).send('Ocorreu um erro ao remover a aplicação.');
    });
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
  if (user.id === '1135054553306365962') {
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
