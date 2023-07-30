// app.js

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fetch = require('node-fetch');
const firebase = require('firebase/app');
require('firebase/database');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');

const app = express();

require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

// Configuração do Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

firebase.initializeApp(firebaseConfig);

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

  // Exemplo: Salvando a nova aplicação no Firebase
  firebase.database().ref(`users/${userId}/applications/${appId}`).set({
    id: appId,
    name: appName,
    status: 'stopped',
    terminal: '',
  })
  .then(() => {
    res.send('Aplicação enviada com sucesso!');
  })
  .catch((err) => {
    console.error('Erro ao enviar a aplicação:', err);
    res.status(500).send('Erro ao enviar a aplicação.');
  });
});

// Rota para visualizar detalhes da aplicação
app.get('/app/:appId', authenticate, (req, res) => {
  const user = req.user;
  const appId = req.params.appId;

  // Verificar se o usuário é o proprietário da aplicação com base no ID da aplicação
  firebase.database().ref(`users/${user.id}/applications/${appId}`).once('value')
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
    .catch((err) => {
      console.error('Erro ao buscar detalhes da aplicação:', err);
      res.status(500).send('Erro ao buscar detalhes da aplicação.');
    });
});

// Rota para remover a aplicação
app.post('/remove', authenticate, (req, res) => {
  const user = req.user;
  const { userId, appId } = req.body;

  // Verificar se o usuário é o bot do Discord (substitua 'SEU_BOT_ID' pelo ID do seu bot)
  if (userId !== 'SEU_BOT_ID') {
    return res.status(403).send('Apenas o bot do Discord pode remover aplicações.');
  }

  // Remova a aplicação do Firebase
  firebase.database().ref(`users/${user.id}/applications/${appId}`).remove()
    .then(() => {
      res.send('Aplicação removida com sucesso!');
    })
    .catch((err) => {
      console.error('Erro ao remover a aplicação:', err);
      res.status(500).send('Erro ao remover a aplicação.');
    });
});

// Rota para iniciar, reiniciar ou parar uma aplicação
app.post('/action', authenticate, (req, res) => {
  const user = req.user;
  const { appId, action } = req.body;

  // Verificar se o usuário é o bot do Discord (substitua 'SEU_BOT_ID' pelo ID do seu bot)
  if (user.id === 'SEU_BOT_ID') {
    // Encontre a aplicação do usuário pelo ID
    firebase.database().ref(`users/${user.id}/applications/${appId}`).once('value')
      .then((snapshot) => {
        const application = snapshot.val();
        if (!application) {
          return res.status(404).send('Aplicação não encontrada.');
        }

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

        // Atualizar o status da aplicação no Firebase
        firebase.database().ref(`users/${user.id}/applications/${appId}`).update({
          status: application.status,
        })
        .then(() => {
          res.send('Ação realizada com sucesso!');
        })
        .catch((err) => {
          console.error('Erro ao atualizar o status da aplicação:', err);
          res.status(500).send('Erro ao atualizar o status da aplicação.');
        });
      })
      .catch((err) => {
        console.error('Erro ao buscar a aplicação:', err);
        res.status(500).send('Erro ao buscar a aplicação.');
      });
  } else {
    res.status(403).send('Apenas o bot do Discord pode executar ações nas aplicações.');
  }
});

// Função para encontrar a aplicação pelo ID da aplicação e ID do usuário
function findApplicationById(userId, appId) {
  // A lógica para encontrar a aplicação foi substituída pelo Firebase, portanto, essa função não é mais necessária.
  // Você pode remover essa função se quiser.
  return undefined;
}

// ...

// Definir a engine de visualização
app.set('view engine', 'ejs');

// Definir a pasta de visualizações
app.set('views', path.join(__dirname, 'views'));

// Definir a pasta de recursos estáticos (por exemplo, arquivos CSS, imagens)
app.use(express.static(path.join(__dirname, 'public')));

// ...

// Definir a porta em que o servidor irá escutar
const port = 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
