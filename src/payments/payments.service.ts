import { Injectable } from '@nestjs/common';
import { LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthUser } from '../auth/auth-user.decorator';
import { User } from '../users/entities/user.entity';
import {
  CreatePaymentInput,
  CreatePaymentOutput,
} from './dtos/create-payment.dto';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { GetPaymentOutput } from './dtos/get-payment.dto';
import { Cron, Interval, SchedulerRegistry, Timeout } from '@nestjs/schedule';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  async createPayment(
    @AuthUser() owner: User,
    { restaurantId, transactionId }: CreatePaymentInput,
  ): Promise<CreatePaymentOutput> {
    try {
      const restaurant = await this.restaurants.findOne({
        where: { id: restaurantId },
      });
      if (!restaurant) {
        return { ok: false, error: "Le restaurant n'a pas été trouvé" };
      }
      //verifie si la personne est proprietaire du restaurant
      if (restaurant.ownerId !== owner.id) {
        return { ok: false, error: "Vous n'avez pas les droits" };
      }

      await this.payments.save(
        this.payments.create({ transactionId, user: owner, restaurant }),
      );

      restaurant.isPromoted = true;
      const date = new Date();
      date.setDate(date.getDate() + 7);
      restaurant.promotedUntil = date;

      await this.restaurants.save(restaurant);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async getPayments(owner: User): Promise<GetPaymentOutput> {
    try {
      const payments = await this.payments.find({ where: { id: owner.id } });
      if (!payments) {
        return { ok: false, error: "Les payements n'ont pas été trouvés" };
      }

      return { ok: true, payments };
    } catch (error) {
      return { ok: false, error: 'impossible de voir les payements' };
    }
  }

  @Cron('* * 8 * * *')
  async checkPromotedRestaurant() {
    const restaurants = await this.restaurants.find({
      where: { isPromoted: true, promotedUntil: LessThanOrEqual(new Date()) },
    });
    console.log(restaurants);

    restaurants.forEach(async (restaurant) => {
      restaurant.isPromoted = false;
      restaurant.promotedUntil = null;
      await this.restaurants.save(restaurant);
    });
  }
}
