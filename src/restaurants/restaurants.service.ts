import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Like, Raw, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AllCategoriesOutput } from './dtos/all-categories.dto';
import {
  CreateRestaurantInput,
  CreateRestaurantOutput,
} from './dtos/create-restaurant.dto';
import {
  DeleteRestaurantInput,
  DeleteRestaurantOutput,
} from './dtos/delete-restaurant.dto';
import {
  EditRestaurantInput,
  EditRestaurantOutput,
} from './dtos/edit-restaurant.dto';
import { Category } from './entities/category.entity';
import { Restaurant } from './entities/restaurant.entity';
import { CategoryInput, CategoryOutput } from './dtos/category.dto';
import { RestaurantsInput, RestaurantsOutput } from './dtos/restaurants.dto';
import { RestaurantInput, RestaurantOutput } from './dtos/restaurant.dto';
import {
  SearchRestaurantInput,
  SearchRestaurantOutput,
} from './dtos/search-restaurant.dto';
import { CreateDishInput, CreateDishOutput } from './dtos/create-dish.dto';
import { Dish } from './entities/dish.entity';
import { EditDishInput, EditDishOutput } from './dtos/edit-dish.dto';
import { DeleteDishInput, DeleteDishOutput } from './dtos/delete-dish.dto';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Dish)
    private readonly dishRepository: Repository<Dish>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

  async getOrCreateCategory(name: string): Promise<Category> {
    const categoryName = name.toLowerCase().trim();
    const categorySlug = categoryName.replaceAll(' ', '-');
    let category = await this.categoryRepository.findOne({
      where: { slug: categorySlug },
    });
    if (!category) {
      category = await this.categoryRepository.save(
        this.categoryRepository.create({
          slug: categorySlug,
          name: categoryName,
        }),
      );
    }

    return category;
  }

  async createRestaurant(
    owner: User,
    createRestaurantInput: CreateRestaurantInput,
  ): Promise<CreateRestaurantOutput> {
    try {
      const newRestaurant = this.restaurantRepository.create({
        ...createRestaurantInput,
        owner,
      });
      // const categoryName = createRestaurantInput.categoryName
      //   .toLowerCase()
      //   .trim();
      // const categorySlug = categoryName.replaceAll(' ', '-');
      // let category = await this.categoryRepository.findOne({
      //   where: { slug: categorySlug },
      // });
      // if (!category) {
      //   category = await this.categoryRepository.save(
      //     this.categoryRepository.create({
      //       slug: categorySlug,
      //       name: categoryName,
      //     }),
      //   );
      // }
      const category = await this.getOrCreateCategory(
        createRestaurantInput.categoryName,
      );
      newRestaurant.category = { ...category };

      await this.restaurantRepository.save({ ...newRestaurant });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: 'Impossible de creer un restaurant',
      };
    }
  }

  async editRestaurant(
    owner: User,
    editRestaurantInput: EditRestaurantInput,
  ): Promise<EditRestaurantOutput> {
    try {
      const restaurant = await this.restaurantRepository.findOne({
        where: { id: editRestaurantInput.restaurantId },
        loadRelationIds: true, //il var charger les ids
      });

      if (!restaurant) {
        return { ok: false, error: "Le restaurant n'a pas été trouvé" };
      }
      //Vu que on charge les ids, alors restaurant.owner est juste lidentifiant du proprietaire
      //Cependant typescript va se plaindre,
      // et nous allons le resoudre avec le decorateur id de relation qui va charger simplement lid de la relation
      if (owner.id !== restaurant.ownerId) {
        return {
          ok: false,
          error:
            "Vous ne pouvez pas editer un restaurant dont vous n'etes pas propietaire",
        };
      }

      //si lentree a une categorie, alors on veut mettre a jour la categorie de ce restaurant
      let category: Category = null;
      if (editRestaurantInput.categoryName) {
        category = await this.getOrCreateCategory(
          editRestaurantInput.categoryName,
        );
      }

      await this.restaurantRepository.save([
        {
          id: editRestaurantInput.restaurantId,
          ...editRestaurantInput,
          ...(category && { category }), //si la categorie existe, il renvoi un objet avec la categorie.
        },
      ]);

      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Impossible de modifier le restaurant' };
    }
  }

  async deleteRestaurant(
    owner: User,
    deleteRestaurantInput: DeleteRestaurantInput,
  ): Promise<DeleteRestaurantOutput> {
    try {
      const restaurant = await this.restaurantRepository.findOne({
        where: { id: deleteRestaurantInput.restaurantId },
        loadRelationIds: true, //il var charger les ids
      });

      if (!restaurant) {
        return { ok: false, error: "Le restaurant n'a pas été trouvé" };
      }
      if (owner.id !== restaurant.ownerId) {
        return {
          ok: false,
          error:
            "Vous ne pouvez pas supprimer un restaurant dont vous n'etes pas propietaire",
        };
      }

      await this.restaurantRepository.delete(
        deleteRestaurantInput.restaurantId,
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Imposible de supprimer le restaurant' };
    }
  }

  async allCategories(): Promise<AllCategoriesOutput> {
    try {
      const categories = await this.categoryRepository.find();
      return { ok: true, categories };
    } catch (error) {
      return { ok: false, error: "Impossible d'obtenir toutes les categories" };
    }
  }

  countRestaurants(category: Category): Promise<number> {
    //obtient le nombre de restaurant pour chaque categorie
    return this.restaurantRepository.count({
      where: { category: { id: category.id } },
    });
  }

  async findCategoryBySlug({
    slug,
    page,
  }: CategoryInput): Promise<CategoryOutput> {
    try {
      const category = await this.categoryRepository.findOne({
        where: { slug },
      });
      if (!category) {
        return { ok: false, error: "La categorie n'a pas été trouvé" };
      }

      const restaurants = await this.restaurantRepository.find({
        where: { category: { id: category.id } },
        order: {
          isPromoted: 'DESC',
        },
        take: 25,
        skip: (page - 1) * 25,
      });
      category.restaurants = restaurants;

      const totalResults = await this.countRestaurants(category);
      const totalPages = Math.ceil(totalResults / 25);

      return { ok: true, category, totalPages };
    } catch (error) {
      return { ok: false, error: 'Impossible de trouvé une categorie' };
    }
  }

  async allRestaurants({ page }: RestaurantsInput): Promise<RestaurantsOutput> {
    try {
      const [restaurants, totalResults] =
        await this.restaurantRepository.findAndCount({
          take: 25,
          skip: (page - 1) * 25,
          order: {
            isPromoted: 'DESC',
          },
        });

      return {
        ok: true,
        results: restaurants,
        totalPages: Math.ceil(totalResults / 25),
        totalResults,
      };
    } catch (error) {
      return { ok: false, error: "Impossible d'obtenir tous les restaurants" };
    }
  }

  async findRestaurantById({
    restaurantId,
  }: RestaurantInput): Promise<RestaurantOutput> {
    try {
      const restaurant = await this.restaurantRepository.findOne({
        where: { id: restaurantId },
        relations: { menu: true },
      });
      if (!restaurant) {
        return { ok: false, error: "Le restaurant n'a pas été trouvé" };
      }

      return { ok: true, restaurant };
    } catch (error) {
      return { ok: false, error: 'Impossible de voir le restaurant' };
    }
  }

  async searchRestaurant({
    page,
    query,
  }: SearchRestaurantInput): Promise<SearchRestaurantOutput> {
    try {
      const [restaurants, totalResults] =
        await this.restaurantRepository.findAndCount({
          where: {
            // name: ILike(`%${query}%`),
            name: Raw((name) => `${name} ILIKE '%${query}%'`),
          },
          take: 25,
          skip: (page - 1) * 25,
        });

      return {
        ok: true,
        restaurants,
        totalResults,
        totalPages: Math.ceil(totalResults / 25),
      };
    } catch (error) {
      return { ok: false, error: 'Impossible de rechercher les restaurants' };
    }
  }

  async createDish(
    owner: User,
    createDishInput: CreateDishInput,
  ): Promise<CreateDishOutput> {
    try {
      const restaurant = await this.restaurantRepository.findOne({
        where: { id: createDishInput.restaurantId },
      });
      if (!restaurant) {
        return { ok: false, error: "Le restaurant n'existe pas" };
      }

      if (owner.id !== restaurant.ownerId) {
        return { ok: false, error: "Vous n'etes pas autorisé à creer un plat" };
      }

      await this.dishRepository.save(
        this.dishRepository.create({ ...createDishInput, restaurant }),
      );

      // dish.restaurant = restaurant
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Impossible de creer le plat' };
    }
  }

  async editDish(
    owner: User,
    editDishInput: EditDishInput,
  ): Promise<EditDishOutput> {
    try {
      const dish = await this.dishRepository.findOne({
        where: { id: editDishInput.dishId },
        relations: { restaurant: true },
      });

      if (!dish) {
        return { ok: false, error: "Le plat n'a pas été trouvé" };
      }

      if (owner.id !== dish.restaurant.ownerId) {
        return {
          ok: false,
          error: "Vous n'etes pas autorisé d'editer le plat",
        };
      }

      await this.dishRepository.save([
        { id: editDishInput.dishId, ...editDishInput },
      ]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: "Impossible d'editer le plat" };
    }
  }

  async deleteDish(
    owner: User,
    { dishId }: DeleteDishInput,
  ): Promise<DeleteDishOutput> {
    try {
      const dish = await this.dishRepository.findOne({
        where: { id: dishId },
        relations: { restaurant: true },
      });

      if (!dish) {
        return { ok: false, error: "Le plat n'a pas été trouvé" };
      }

      if (owner.id !== dish.restaurant.ownerId) {
        return {
          ok: false,
          error: "Vous n'etes pas autorisé de supprimer le plat",
        };
      }

      await this.dishRepository.delete(dishId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'Impossible de supprimer le plat' };
    }
  }
}
