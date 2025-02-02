import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/entities/user.entity';
import { CreateOrderInput, CreateOrderOutput } from './dtos/create-order.dto';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { OrderItem } from './entities/order-item.entity';
import { Dish } from '../restaurants/entities/dish.entity';
import { ok } from 'assert';
import { GetOrdersInput, GetOrdersOutput } from './dtos/get-orders.dto';
import { GetOrderInput, GetOrderOutput } from './dtos/get-order.dto';
import { EditOrderInput, EditOrderOutput } from './dtos/edit-order.dto';
import {
  NEW_COOKED_ORDER,
  NEW_ORDER_UPDATE,
  NEW_PENDING_ORDER,
  PUB_SUB,
} from '../common/common.constants';
import { PubSub } from 'graphql-subscriptions';
import { TakeOrderInput, TakeOrderOutput } from './dtos/take-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(Dish)
    private readonly dishes: Repository<Dish>,
    @Inject(PUB_SUB) private pubSub: PubSub,
  ) {}

  async createOrder(
    customer: User,
    { restaurantId, items }: CreateOrderInput,
  ): Promise<CreateOrderOutput> {
    try {
      const restaurant = await this.restaurants.findOne({
        where: { id: restaurantId },
      });
      if (!restaurant) {
        return { ok: false, error: "Le restaurant n'a pas été trouvé" };
      }

      let orderFinalPrice = 0;
      let orderItems: OrderItem[] = [];
      for (let item of items) {
        const dish = await this.dishes.findOne({ where: { id: item.dishId } });
        if (!dish) {
          return { ok: false, error: 'Oups! une erreur est survenue' };
        }

        let dishFinalPrice = dish.price;
        for (let itemOption of item.options) {
          const dishOption = dish.options.find(
            (dishOption) => dishOption.name === itemOption.name,
          );

          if (dishOption) {
            if (dishOption.extra) {
              dishFinalPrice = dishFinalPrice + dishOption.extra;
            } else {
              const dishOptionChoice = dishOption.choices.find(
                (dishOptionChoice) =>
                  dishOptionChoice.name === itemOption.choice,
              );
              if (dishOptionChoice) {
                if (dishOptionChoice.extra) {
                  dishFinalPrice = dishFinalPrice + dishOptionChoice.extra;
                }
              }
            }
          }
        }
        orderFinalPrice = orderFinalPrice + dishFinalPrice;

        const orderItem = await this.orderItems.save(
          this.orderItems.create({
            dish,
            options: item.options,
          }),
        );
        orderItems.push(orderItem);
      }

      const order = await this.orders.save(
        this.orders.create({
          customer,
          restaurant,
          total: orderFinalPrice,
          items: orderItems,
        }),
      );
      await this.pubSub.publish(NEW_PENDING_ORDER, {
        pendingOrders: { order, ownerId: restaurant.ownerId },
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Impossible de creer une commande' };
    }
  }

  async getOrders(
    user: User,
    { status }: GetOrdersInput,
  ): Promise<GetOrdersOutput> {
    try {
      let orders: Order[] = [];
      if (user.role === UserRole.Client) {
        orders = await this.orders.find({
          where: { customer: { id: user.id }, ...(status && { status }) },
        });
        // console.log(orders);
      } else if (user.role === UserRole.Delivery) {
        orders = await this.orders.find({
          where: { driver: { id: user.id }, ...(status && { status }) },
        });
      } else if (user.role === UserRole.Owner) {
        const restaurants = await this.restaurants.find({
          where: { owner: { id: user.id } },
          select: ['orders'],
          relations: { orders: true },
        });

        orders = restaurants.map((resto) => resto.orders).flat(1);
        if (status) {
          orders = orders.filter((o) => o.status === status);
        }
      }
      return { ok: true, orders };
    } catch (error) {
      return { ok: false, error: "Impossible d'obtenir les commandes" };
    }
  }

  canSeeOrder(user: User, order: Order): boolean {
    let canSee = true;
    if (user.role === UserRole.Client && order.customerId !== user.id) {
      canSee = false;
    }

    if (user.role === UserRole.Delivery && order.driverId !== user.id) {
      canSee = false;
    }

    if (user.role === UserRole.Owner && order.restaurant.ownerId !== user.id) {
      canSee = false;
    }

    return canSee;
  }

  async getOrder(
    user: User,
    { id: orderId }: GetOrderInput,
  ): Promise<GetOrderOutput> {
    try {
      const order = await this.orders.findOne({
        where: { id: orderId },
        relations: { restaurant: true },
      });
      if (!order) {
        return { ok: false, error: 'La commande est introuvable' };
      }

      const canSee = this.canSeeOrder(user, order);

      if (!canSee) {
        return { ok: false, error: "Vous n'etes pas autorisé" };
      }

      return { ok: true, order };
    } catch (error) {
      return { ok: false, error: "Impossible d'obtenir la commande" };
    }
  }

  async editOrder(
    user: User,
    { id: orderId, status }: EditOrderInput,
  ): Promise<EditOrderOutput> {
    try {
      const order = await this.orders.findOne({
        where: { id: orderId },
      });
      if (!order) {
        return { ok: false, error: "La commande n'a pas été trouvé" };
      }

      if (!this.canSeeOrder(user, order)) {
        return { ok: false, error: "Vous n'etes pas autorisé" };
      }

      let canEdit = true;

      if (user.role === UserRole.Client) {
        canEdit = false;
      }
      if (user.role === UserRole.Owner) {
        if (status !== OrderStatus.Cooking && status !== OrderStatus.Cooked) {
          canEdit = false;
        }
      }

      if (user.role === UserRole.Delivery) {
        if (
          status !== OrderStatus.PickedUp &&
          status !== OrderStatus.Delivered
        ) {
          canEdit = false;
        }
      }
      if (!canEdit) {
        return { ok: false, error: "Vous n'etes pas autorisé" };
      }

      await this.orders.save([
        {
          id: orderId,
          status,
        },
      ]);

      const newOrder = { ...order, status };
      if (user.role === UserRole.Owner) {
        if (status === OrderStatus.Cooked) {
          //Si la nouvelle commande a été mis a jour,
          // nous allons attendre que ce pubsub publie la mise ajour de la nouvelle commande
          await this.pubSub.publish(NEW_COOKED_ORDER, {
            cookedOrders: newOrder,
          });
        }
      }

      await this.pubSub.publish(NEW_ORDER_UPDATE, { orderUpdates: newOrder });

      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Impossible de mettre à jour la commande' };
    }
  }

  async takeOrder(
    driver: User,
    { id: orderId }: TakeOrderInput,
  ): Promise<TakeOrderOutput> {
    try {
      const order = await this.orders.findOne({ where: { id: orderId } });
      if (!order) {
        return { ok: false, error: "La commande n'a pas été trouvé" };
      }

      if (order.driver) {
        return { ok: false, error: 'Cette commande a déjà un livreur' };
      }

      await this.orders.save([
        {
          id: orderId,
          driver,
        },
      ]);
      await this.pubSub.publish(NEW_ORDER_UPDATE, {
        orderUpdates: { ...order, driver },
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Impossible de mettre à jour la commande' };
    }
  }
}
