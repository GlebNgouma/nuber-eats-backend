import { InputType, ObjectType, PickType } from '@nestjs/graphql';
import { EditRestaurantInput } from './edit-restaurant.dto';
import { CoreOutput } from '../../common/dtos/output.dto';

@InputType()
export class DeleteRestaurantInput extends PickType(EditRestaurantInput, [
  'restaurantId',
]) {}

@ObjectType()
export class DeleteRestaurantOutput extends CoreOutput {}
