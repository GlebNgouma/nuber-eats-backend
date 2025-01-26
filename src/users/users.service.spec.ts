import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Verification } from './entities/verification.entity';
import { JwtService } from '../jwt/jwt.service';
import { MailService } from '../mail/mail.service';
import { Repository } from 'typeorm';
import { error } from 'console';

const mockRepository = () => ({
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  findOneByOrFail: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

const mockJwtService = () => ({
  sign: jest.fn(() => 'signed-token'),
  verify: jest.fn(),
});

const mockMailService = () => ({
  sendVerificationEmail: jest.fn(),
});

enum UserRole {
  Client = 'client',
  Owrner = 'owner',
  Delivery = 'delivery',
}

type MockRepository<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

describe('UsersService', () => {
  let service: UsersService;
  //Obtenir toutes les cles de ce referentiel et rendre toutes les proprietes facultatives
  let usersRepository: MockRepository<User>;
  let verificationsRepository: MockRepository<Verification>;
  let mailService: MailService;
  let jwtService: JwtService;
  //Avant tous les tests, je vais creer un module de test
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepository() },
        {
          provide: getRepositoryToken(Verification),
          useValue: mockRepository(),
        },
        { provide: JwtService, useValue: mockJwtService() },
        { provide: MailService, useValue: mockMailService() },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    usersRepository = module.get(getRepositoryToken(User));
    verificationsRepository = module.get(getRepositoryToken(Verification));
    mailService = module.get(MailService);
    jwtService = module.get(JwtService);
  });

  //Attendre que le service soit definit
  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  //Je dois donc simuler 1 user existant.Le test va reussir si il ya deja un user dans la BD
  describe('createAccount', () => {
    const createAccountArgs = {
      email: '',
      password: '',
      role: UserRole.Client,
    };
    it("Il doit echouer si l'utilisateur existe", async () => {
      usersRepository.findOneBy.mockResolvedValue({
        id: 1,
        email: 'lalalala',
      });
      const result = await service.createAccount(createAccountArgs);

      expect(result).toMatchObject({
        ok: false,
        error: "Il y'a deja un utilisateur avec cet email",
      });
    });

    it('doit creer un nouveau utilisateur', async () => {
      usersRepository.findOneBy.mockResolvedValue(undefined);
      usersRepository.create.mockReturnValue(createAccountArgs);
      usersRepository.save.mockResolvedValue(createAccountArgs);

      verificationsRepository.create.mockReturnValue({
        user: createAccountArgs,
      });
      verificationsRepository.save.mockResolvedValue({ code: 'code' });

      const result = await service.createAccount(createAccountArgs);
      //Je mattends a ce qu'une fonction ait ete appelee une seule fois
      expect(usersRepository.create).toHaveBeenCalledTimes(1);
      expect(usersRepository.create).toHaveBeenCalledWith(createAccountArgs);

      expect(usersRepository.save).toHaveBeenCalledTimes(1);
      expect(usersRepository.save).toHaveBeenCalledWith(createAccountArgs);

      expect(verificationsRepository.create).toHaveBeenCalledTimes(1);
      expect(verificationsRepository.create).toHaveBeenCalledWith({
        user: createAccountArgs,
      });
      expect(verificationsRepository.save).toHaveBeenCalledTimes(1);
      expect(verificationsRepository.save).toHaveBeenCalledWith({
        user: createAccountArgs,
      });

      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
      );

      expect(result).toEqual({ ok: true });
    });

    it('Il doit echouer sur exception', async () => {
      usersRepository.findOneBy.mockRejectedValue(new Error());
      const result = await service.createAccount(createAccountArgs);
      expect(result).toEqual({
        ok: false,
        error: "Le compte n'a pas pu etre crée",
      });
    });
  });

  describe('login', () => {
    const loginArgs = {
      email: 'bs@gmail.com',
      password: 'bs.password',
    };
    it("doit echouer si le user n'existe pas", async () => {
      usersRepository.findOne.mockResolvedValue(null);

      const result = await service.login(loginArgs);

      expect(usersRepository.findOne).toHaveBeenCalledTimes(1);
      expect(usersRepository.findOne).toHaveBeenCalledWith(expect.any(Object));
      expect(result).toEqual({
        ok: false,
        error: "L'utilisateur n'a pas été trouvé",
      });
    });

    it('Il doit echouer si le mot de passe est erroné', async () => {
      const mockUser = {
        id: 1,
        checkPassword: jest.fn(() => Promise.resolve(false)),
      };
      usersRepository.findOne.mockResolvedValue(mockUser);
      const result = await service.login(loginArgs);
      expect(result).toEqual({ ok: false, error: 'Mot de passe incorrect' });
    });

    it('Renvoi un jeton si le mot de passe est correcte', async () => {
      const mockUser = {
        id: 1,
        checkPassword: jest.fn(() => Promise.resolve(true)),
      };
      usersRepository.findOne.mockResolvedValue(mockUser);
      const result = await service.login(loginArgs);

      expect(jwtService.sign).toHaveBeenCalledTimes(1);
      expect(jwtService.sign).toHaveBeenCalledWith(expect.any(Number));
      expect(result).toEqual({ ok: true, token: 'signed-token' });
    });

    it('Il doit echouer sur exception', async () => {
      usersRepository.findOne.mockRejectedValue(new Error());
      const result = await service.login(loginArgs);

      expect(result).toEqual({
        ok: false,
        error: 'Impossible de se connecter',
      });
    });
  });

  describe('findById', () => {
    const userArgs = {
      email: '',
      password: '',
      role: UserRole.Client,
    };

    it("Renvoi un utilisateur s'il est trouvé", async () => {
      usersRepository.findOneByOrFail.mockResolvedValue(userArgs);
      const result = await service.findById(1);
      expect(result).toEqual({
        ok: true,
        user: { email: '', password: '', role: 'client' },
      });
    });

    it("Il doit echouer si aucun user n'est trouvé", async () => {
      usersRepository.findOneByOrFail.mockRejectedValue(new Error());
      const result = await service.findById(1);
      expect(result).toEqual({ ok: false, error: 'Utilisateur non trouvé' });
    });
  });

  describe('editProfile', () => {
    it('Should change email', async () => {
      const oldUser = {
        email: 'bs@email.com',
        verified: true,
      };
      const editProfileArgs = {
        userId: 1,
        input: { email: 'bs@new.com' },
      };
      const newVerification = {
        code: 'code',
      };

      const newUser = {
        verified: false,
        email: editProfileArgs.input.email,
      };

      usersRepository.findOneBy.mockResolvedValue(oldUser);
      verificationsRepository.create.mockReturnValue(newVerification);
      verificationsRepository.save.mockResolvedValue(newVerification);

      await service.editProfile(editProfileArgs.userId, editProfileArgs.input);

      expect(usersRepository.findOneBy).toHaveBeenCalledTimes(1);
      expect(usersRepository.findOneBy).toHaveBeenCalledWith(
        expect.any(Object),
      );

      // expect(verificationsRepository.create).toHaveBeenCalledTimes(1);
      expect(verificationsRepository.create).toHaveBeenCalledWith({
        user: newUser,
      });
      expect(verificationsRepository.save).toHaveBeenCalledWith(
        newVerification,
      );

      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        newUser.email,
        newVerification.code,
      );
    });

    it('Changer de mot de passe', async () => {
      const editProfileArgs = {
        userId: 1,
        input: { password: 'new.password' },
      };
      usersRepository.findOneBy.mockResolvedValue({ password: 'old' });

      const result = await service.editProfile(
        editProfileArgs.userId,
        editProfileArgs.input,
      );

      expect(usersRepository.save).toHaveBeenCalledTimes(1);
      expect(usersRepository.save).toHaveBeenCalledWith(editProfileArgs.input);

      expect(result).toEqual({ ok: true });
    });

    it("Il doit echouer en cas d'exception", async () => {
      usersRepository.findOneBy.mockRejectedValue(new Error());
      const result = await service.editProfile(1, { email: '12' });
      expect(result).toEqual({
        ok: false,
        error: 'Impossible de mettre à jour le profile',
      });
    });
  });

  describe('verifyEmail', () => {
    it("Doit verififer l'email", async () => {
      const mockedVerification = {
        user: {
          verified: false,
        },
        id: 1,
      };
      verificationsRepository.findOne.mockResolvedValue(mockedVerification);

      const result = await service.verifyEmail('');

      expect(verificationsRepository.findOne).toHaveBeenCalledTimes(1);
      expect(verificationsRepository.findOne).toHaveBeenCalledWith(
        expect.any(Object),
      );

      expect(usersRepository.save).toHaveBeenCalledTimes(1);
      expect(usersRepository.save).toHaveBeenCalledWith({ verified: true });

      expect(verificationsRepository.delete).toHaveBeenCalledTimes(1);
      expect(verificationsRepository.delete).toHaveBeenCalledWith(
        mockedVerification.id,
      );

      expect(result).toEqual({ ok: true });
    });

    it('Doit echouer sil une verification na pas ete trouvé', async () => {
      verificationsRepository.findOne.mockResolvedValue(null);

      const result = await service.verifyEmail('');
      expect(result).toEqual({ ok: false, error: 'Verification non trouvé' });
    });

    it('Doit echouer sil y a une exception', async () => {
      verificationsRepository.findOne.mockRejectedValue(new Error());
      const result = await service.verifyEmail('');
      expect(result).toEqual({
        ok: false,
        error: "L'email n'a pas été verifé",
      });
    });
  });
});
