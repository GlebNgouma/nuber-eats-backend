// import { Category } from "../entities/category.entity"

// export const CategoryRepository = dataSource.getRepository(Category).extend({
//     findByName(firstName: string, lastName: string) {
//         return this.createQueryBuilder("user")
//             .where("user.firstName = :firstName", { firstName })
//             .andWhere("user.lastName = :lastName", { lastName })
//             .getMany()
//     },
// })

// import { EntityRepository, Repository } from 'typeorm';
// import { Category } from '../entities/category.entity';

// @EntityRepository(Category)
// export class CategoryRepository extends Repository<Category> {

//   async getOrCreate(name: string): Promise<Category> {
//     const categoryName = name.toLowerCase().trim();
//     const categorySlug = categoryName.replaceAll(' ', '-');
//     let category = await this.findOne({
//       where: { slug: categorySlug },
//     });
//     if (!category) {
//       category = await this.save(
//         this.create({
//           slug: categorySlug,
//           name: categoryName,
//         }),
//       );
//     }

//     return category;
//   }
// }
