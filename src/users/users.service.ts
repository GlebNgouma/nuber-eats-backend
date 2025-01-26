import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '../jwt/jwt.service';
import {
  CreateAccountInput,
  CreateAccountOutput,
} from './dtos/create-account.dto';
import { EditProfileInput, EditProfileOutput } from './dtos/edit-profile.dto';
import { LoginInput, LoginOutput } from './dtos/login.dto';
import { UserProfileOutput } from './dtos/user-profile.dto';
import { VerifyEmailOutput } from './dtos/verify-email.dto';
import { User } from './entities/user.entity';
import { Verification } from './entities/verification.entity';
import { MailService } from '../mail/mail.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    @InjectRepository(Verification)
    private readonly verificationsRepository: Repository<Verification>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async createAccount({
    email,
    password,
    role,
  }: CreateAccountInput): Promise<CreateAccountOutput> {
    try {
      const exists = await this.usersRepository.findOneBy({ email });
      if (exists) {
        return {
          ok: false,
          error: "Il y'a deja un utilisateur avec cet email",
        };
      }
      const user = await this.usersRepository.save(
        this.usersRepository.create({ email, password, role }),
      );

      const verification = await this.verificationsRepository.save(
        this.verificationsRepository.create({ user }),
      );

      this.mailService.sendVerificationEmail(user.email, verification.code);

      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: "Le compte n'a pas pu etre crée",
      };
    }
  }

  async login({ email, password }: LoginInput): Promise<LoginOutput> {
    try {
      const user = await this.usersRepository.findOne({
        where: { email },
        select: ['id', 'password'],
      });
      if (!user) {
        return {
          ok: false,
          error: "L'utilisateur n'a pas été trouvé",
        };
      }

      const passwordCorrect = await user.checkPassword(password);
      if (!passwordCorrect) {
        return {
          ok: false,
          error: 'Mot de passe incorrect',
        };
      }

      const token = this.jwtService.sign(user.id);

      return { ok: true, token };
    } catch (error) {
      return {
        ok: false,
        error: 'Impossible de se connecter',
      };
    }
  }

  async findById(id: number): Promise<UserProfileOutput> {
    try {
      const user = await this.usersRepository.findOneByOrFail({ id });
      return { ok: true, user };
    } catch (error) {
      return { ok: false, error: 'Utilisateur non trouvé' };
    }
  }

  async editProfile(
    userId: number,
    { email, password }: EditProfileInput,
  ): Promise<EditProfileOutput> {
    try {
      const user = await this.usersRepository.findOneBy({ id: userId });
      if (email) {
        user.email = email;
        user.verified = false;

        await this.verificationsRepository.delete({ user: { id: user.id } });

        const verification = await this.verificationsRepository.save(
          this.verificationsRepository.create({ user }),
        );
        this.mailService.sendVerificationEmail(user.email, verification.code);
      }
      if (password) {
        user.password = password;
      }
      await this.usersRepository.save(user);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Impossible de mettre à jour le profile' };
    }
  }

  async verifyEmail(code: string): Promise<VerifyEmailOutput> {
    try {
      //Chercher la verification
      const verification = await this.verificationsRepository.findOne({
        where: { code },
        relations: { user: true },
      });
      //Si elle existe, on la supprime
      if (verification) {
        verification.user.verified = true;
        await this.usersRepository.save(verification.user);
        await this.verificationsRepository.delete(verification.id);
        return { ok: true };
      }
      return { ok: false, error: 'Verification non trouvé' };
    } catch (error) {
      return { ok: false, error: "L'email n'a pas été verifé" };
    }
  }
}
