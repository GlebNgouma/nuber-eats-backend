import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Verification } from '../src/users/entities/verification.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

jest.mock('got', () => {
  return {
    post: jest.fn(),
  };
});
const GRAPHQL_ENDPOINT = '/graphql';

const testUser = {
  email: 'nico@las.com',
  password: '1234',
};

const dataSource = new DataSource({
  // Configuration de votre base de données
  type: 'postgres', // Exemple pour PostgreSQL
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [User, Verification],
  synchronize: true,
  logging: false,
});

describe('UserModule (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let usersRepository: Repository<User>;
  let verificationsRepository: Repository<Verification>;

  const baseTest = () => request(app.getHttpServer()).post(GRAPHQL_ENDPOINT);
  const publicTest = (query: string) => baseTest().send({ query });
  const privateTest = (query: string) =>
    baseTest().set('x-jwt', token).send({ query });

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    usersRepository = module.get(getRepositoryToken(User));
    verificationsRepository = module.get<Repository<Verification>>(
      getRepositoryToken(Verification),
    );
    await dataSource.initialize();
    await app.init();
  });

  afterAll(async () => {
    // Effectuez la destruction de la base de données et la fermeture de la connexion
    if (dataSource.isInitialized) {
      await dataSource.dropDatabase();
      await dataSource.destroy();
    }
    app.close();
  });

  describe('createAccount', () => {
    const EMAIL = 'nico@las.com';
    const PASSWORD = '1234';
    it('should create account', () => {
      return publicTest(
        `
        mutation {
  createAccount(
    input: { email: "${testUser.email}", password: "${testUser.password}", role: Owrner }
  ) {
    error
    ok
  }
}
`,
      )
        .expect(200)
        .expect((res) => {
          expect(res.body.data.createAccount.ok).toBe(true);
          expect(res.body.data.createAccount.error).toBe(null);
        });
    });

    it('doit echouer si le compte existe deja', () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .send({
          query: `
        mutation {
  createAccount(
    input: { email: "${testUser.email}", password: "${testUser.password}", role: Owrner }
  ) {
    error
    ok
  }
}
`,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.createAccount.ok).toBe(false);
          expect(res.body.data.createAccount.error).toEqual(expect.any(String));
        });
    });
  });

  describe('login', () => {
    it("doit se connecter avec les bonnes infos d'identification", () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .send({
          query: `
          mutation {
  login(input: { email: "${testUser.email}", password: "${testUser.password}" }) {
    error
    ok
    token
  }
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: { login },
            },
          } = res;

          expect(login.ok).toBe(true);
          expect(login.error).toBe(null);
          expect(login.token).toEqual(expect.any(String));
          token = login.token;
        });
    });

    it("ne pas pouvoir se connecter avec les infos d'identification erroné", () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .send({
          query: `
        mutation {
login(input: { email: "${testUser.email}", password: "123456" }) {
  error
  ok
  token
}
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: { login },
            },
          } = res;

          expect(login.ok).toBe(false);
          expect(login.error).toBe('Mot de passe incorrect');
          expect(login.token).toBe(null);
        });
    });
  });

  describe('userProfile', () => {
    let userId: number;
    beforeAll(async () => {
      const [user] = await usersRepository.find();
      userId = user.id;
    });

    it("doit voir le profil d'un utilisateur par son id", () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .set('x-jwt', `${token}`)
        .send({
          query: `
        {
  userProfile(userId: ${userId}) {
    ok
    error
    user {
      id
    }
  }
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: {
                userProfile: {
                  ok,
                  error,
                  user: { id },
                },
              },
            },
          } = res;
          expect(ok).toBe(true);
          expect(error).toBe(null);
          expect(id).toBe(userId);
        });
    });

    it('ne doit pas trouver le profile', () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .set('x-jwt', `${token}`)
        .send({
          query: `
      {
userProfile(userId:66) {
  ok
  error
  user {
    id
  }
}
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: {
                userProfile: { ok, error, user },
              },
            },
          } = res;
          expect(ok).toBe(false);
          expect(error).toBe('Utilisateur non trouvé');
          expect(user).toBe(null);
        });
    });
  });

  describe('me', () => {
    it('il devrait trouver mon profile', () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .set('x-jwt', token)
        .send({
          query: `
      {
  me {
    email
  }
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: {
                me: { email },
              },
            },
          } = res;

          expect(email).toBe(testUser.email);
        });
    });

    it('ne pas autoriser les user deconnectés', () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .send({
          query: `
    {
me {
  email
}
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: { errors },
          } = res;
          const [error] = errors;
          expect(error.message).toBe('Forbidden resource');
        });
    });
  });

  describe('editProfile', () => {
    const NEW_EMAIL = 'nico@new.com';
    it("chager l'email", () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .set('x-jwt', token)
        .send({
          query: `
        mutation {
  editProfile(input: { email: "${NEW_EMAIL}"}) {
    ok
    error
  }
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: {
                editProfile: { ok, error },
              },
            },
          } = res;

          expect(ok).toBe(true);
          expect(error).toBe(null);
        });
    });

    it('doit avoir un nouveau email', () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .set('x-jwt', token)
        .send({
          query: `
    {
me {
  email
}
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: {
                me: { email },
              },
            },
          } = res;

          expect(email).toBe(NEW_EMAIL);
        });
    });
  });

  describe('verifyEmail', () => {
    let verificationCode: string;
    beforeAll(async () => {
      const [verification] = await verificationsRepository.find();
      console.log(verification);
      verificationCode = verification.code;
    });

    it("doit verifier l'email", () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .send({
          query: `
        mutation {
  verifyEmail(input: { code: "${verificationCode}" }) {
    ok
    error
  }
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: {
                verifyEmail: { ok, error },
              },
            },
          } = res;

          expect(ok).toBe(true);
          expect(error).toBe(null);
        });
    });

    it('doit echouer pour un mauvais code de verification', () => {
      return request(app.getHttpServer())
        .post(GRAPHQL_ENDPOINT)
        .send({
          query: `
      mutation {
verifyEmail(input: { code: "xxxxxxx" }) {
  ok
  error
}
}
`,
        })
        .expect(200)
        .expect((res) => {
          const {
            body: {
              data: {
                verifyEmail: { ok, error },
              },
            },
          } = res;

          expect(ok).toBe(false);
          expect(error).toBe('Verification non trouvé');
        });
    });
  });
});
